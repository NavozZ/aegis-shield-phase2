import {
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  randomBytes,
  sign as signOneShot,
  timingSafeEqual,
  verify as verifyOneShot,
  createCipheriv,
  createDecipheriv,
  type KeyObject,
} from 'node:crypto';
import {
  SABCL_KEY_BYTES,
  SABCL_NONCE_BYTES,
  SABCL_TAG_BYTES,
} from '../protocol/version.js';
import { SabclError } from '../protocol/errors.js';

/*
 * Every primitive below is Node's maintained `node:crypto` implementation.
 * Nothing in this file invents a construction: it composes X25519, HKDF-SHA-256,
 * AES-256-GCM and Ed25519 in their standard shapes.
 */

export const toBase64Url = (value: Buffer): string =>
  value.toString('base64url');

/**
 * Strict base64url decode.
 *
 * `Buffer.from(value, 'base64url')` silently ignores invalid characters, which
 * would let two different wire strings decode to the same bytes and break the
 * signature binding. Re-encoding and comparing rejects any non-canonical input.
 */
export function fromBase64Url(value: string, field: string): Buffer {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SabclError('SABCL_MALFORMED', `${field} is empty`);
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) {
    throw new SabclError(
      'SABCL_MALFORMED',
      `${field} is not canonical base64url`,
    );
  }
  return decoded;
}

/** Constant-time byte comparison that never short-circuits on length. */
export function timingSafeBytesEqual(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) {
    // Compare against a same-length copy so the failure path still costs the
    // same as a successful comparison of `left`.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** 128-bit CSPRNG identifier, base64url encoded. */
export const randomId = (bytes: number): string =>
  toBase64Url(randomBytes(bytes));

/** Fresh 96-bit AES-GCM nonce. Never derived, never reused, never zero-filled. */
export const newNonce = (): Buffer => randomBytes(SABCL_NONCE_BYTES);

/**
 * X25519 ECDH.
 *
 * Node rejects the all-zero shared secret produced by low-order points, so a
 * contributory-behaviour check is not needed on top.
 */
export function deriveSharedSecret(
  privateKey: KeyObject,
  publicKey: KeyObject,
): Buffer {
  try {
    return diffieHellman({ privateKey, publicKey });
  } catch {
    throw new SabclError('SABCL_DECRYPTION_FAILED', 'ECDH failed');
  }
}

/**
 * HKDF-SHA-256.
 *
 * `salt` is the message nonce and `info` carries the domain tag plus the bound
 * header, so the same ECDH secret yields a different key for every message and
 * for every direction of the exchange.
 */
export function deriveKey(
  sharedSecret: Buffer,
  salt: Buffer,
  info: Buffer,
): Buffer {
  return Buffer.from(
    hkdfSync('sha256', sharedSecret, salt, info, SABCL_KEY_BYTES),
  );
}

export interface AeadResult {
  ciphertext: Buffer;
  tag: Buffer;
}

/**
 * AES-256-GCM seal. The additional authenticated data is the canonical envelope
 * header, so any change to routing metadata invalidates the tag.
 */
export function aeadSeal(
  key: Buffer,
  nonce: Buffer,
  plaintext: Buffer,
  additionalData: Buffer,
): AeadResult {
  const cipher = createCipheriv('aes-256-gcm', key, nonce, {
    authTagLength: SABCL_TAG_BYTES,
  });
  cipher.setAAD(additionalData);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, tag: cipher.getAuthTag() };
}

/**
 * AES-256-GCM open. Any authentication failure — tampered ciphertext, tampered
 * header, wrong key — surfaces as the same error code.
 */
export function aeadOpen(
  key: Buffer,
  nonce: Buffer,
  ciphertext: Buffer,
  tag: Buffer,
  additionalData: Buffer,
): Buffer {
  if (tag.length !== SABCL_TAG_BYTES) {
    throw new SabclError('SABCL_DECRYPTION_FAILED', 'tag length');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, {
      authTagLength: SABCL_TAG_BYTES,
    });
    decipher.setAAD(additionalData);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new SabclError('SABCL_DECRYPTION_FAILED');
  }
}

/** Ed25519 signature over the canonical signing input. */
export function signBytes(privateKey: KeyObject, message: Buffer): Buffer {
  return signOneShot(null, message, privateKey);
}

/** Ed25519 verification. Returns false rather than throwing on malformed input. */
export function verifyBytes(
  publicKey: KeyObject,
  message: Buffer,
  signature: Buffer,
): boolean {
  try {
    return verifyOneShot(null, message, publicKey, signature);
  } catch {
    return false;
  }
}

/** HMAC-SHA-256, used only for deriving opaque route tokens and handles. */
export function hmacSha256(secret: Buffer, message: string): Buffer {
  return createHmac('sha256', secret).update(message, 'utf8').digest();
}

/** Parses a base64url-encoded raw key into a Node key object. */
export function importKey(
  material: string,
  type:
    'x25519-private' | 'x25519-public' | 'ed25519-private' | 'ed25519-public',
  field: string,
): KeyObject {
  const raw = fromBase64Url(material, field);
  const curve = type.startsWith('x25519') ? 'X25519' : 'Ed25519';
  try {
    if (type.endsWith('private')) {
      // Raw 32-byte scalars are wrapped in the minimal PKCS#8 prefix for the
      // curve rather than requiring callers to hold DER in configuration.
      if (raw.length !== 32) {
        throw new SabclError('SABCL_MALFORMED', `${field} must be 32 bytes`);
      }
      const prefix =
        curve === 'X25519'
          ? Buffer.from('302e020100300506032b656e04220420', 'hex')
          : Buffer.from('302e020100300506032b657004220420', 'hex');
      return createPrivateKey({
        key: Buffer.concat([prefix, raw]),
        format: 'der',
        type: 'pkcs8',
      });
    }
    if (raw.length !== 32) {
      throw new SabclError('SABCL_MALFORMED', `${field} must be 32 bytes`);
    }
    const prefix =
      curve === 'X25519'
        ? Buffer.from('302a300506032b656e032100', 'hex')
        : Buffer.from('302a300506032b6570032100', 'hex');
    return createPublicKey({
      key: Buffer.concat([prefix, raw]),
      format: 'der',
      type: 'spki',
    });
  } catch (error) {
    if (error instanceof SabclError) throw error;
    throw new SabclError(
      'SABCL_MALFORMED',
      `${field} is not a valid ${curve} key`,
    );
  }
}

/** Exports the raw 32-byte public point of an X25519 or Ed25519 key. */
export function exportRawPublicKey(key: KeyObject): Buffer {
  const der = key.export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 32);
}

/** Exports the raw 32-byte private scalar of an X25519 or Ed25519 key. */
export function exportRawPrivateKey(key: KeyObject): Buffer {
  const der = key.export({ format: 'der', type: 'pkcs8' });
  return der.subarray(der.length - 32);
}
