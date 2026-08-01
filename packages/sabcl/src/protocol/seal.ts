import { generateKeyPairSync } from 'node:crypto';
import {
  canonicalRequestHeader,
  canonicalResponseHeader,
  sabclEnvelopeSchema,
  sabclResponseEnvelopeSchema,
  type SabclEnvelope,
  type SabclResponseEnvelope,
} from './envelope.js';
import { SabclError } from './errors.js';
import { padPayload, unpadPayload } from './padding.js';
import {
  SABCL_CLOCK_SKEW_SECONDS,
  SABCL_DEFAULT_HOP_LIMIT,
  SABCL_DEFAULT_TTL_SECONDS,
  SABCL_DOMAIN,
  SABCL_MAX_HOP_LIMIT,
  SABCL_MAX_TTL_SECONDS,
  SABCL_MESSAGE_ID_BYTES,
  SABCL_PROTOCOL_VERSION,
} from './version.js';
import {
  aeadOpen,
  aeadSeal,
  deriveKey,
  deriveSharedSecret,
  exportRawPublicKey,
  fromBase64Url,
  importKey,
  newNonce,
  randomId,
  signBytes,
  toBase64Url,
  verifyBytes,
} from '../crypto/primitives.js';
import type {
  SabclKeyring,
  SabclPrivateIdentity,
  SabclPublicIdentity,
} from '../crypto/keyring.js';
import { canonicalEncode } from './canonical.js';

/*
 * Construction, per request:
 *
 *   epk, esk  <- fresh X25519 pair (one message, then discarded)
 *   ss        <- X25519(esk, recipient encryption public key)
 *   k         <- HKDF-SHA-256(ikm = ss, salt = nonce,
 *                             info = "SABCL/1 request-key" || canonical header)
 *   ct, tag   <- AES-256-GCM(k, nonce, pad(payload), aad = canonical header)
 *   sig       <- Ed25519(sender signing key,
 *                        "SABCL/1 request-signature" || header || ct || tag)
 *
 * Which yields, in the order the roadmap asks for them:
 *
 *   confidentiality   ss is unavailable without the recipient's private key;
 *                     the router holds no such key.
 *   integrity         GCM tag over ciphertext.
 *   authenticity      Ed25519 signature by a key the recipient has configured.
 *   recipient binding rkid is in the AAD and in the HKDF info, and ss is
 *                     computed against that recipient's key, so a message
 *                     re-addressed to another service decrypts to nothing.
 *   route binding     rt is in the AAD, so swapping the route token breaks both
 *                     the tag and the signature.
 *   expiry            exp is in the AAD and checked before decryption.
 *   replay            mid is in the AAD and recorded by the router.
 *   forward secrecy   esk is discarded after sealing, so compromising a
 *                     recipient's long-term key later does not decrypt captured
 *                     traffic. (The recipient's static key is still needed to
 *                     decrypt at the time of receipt; this is one-sided.)
 */

export interface SealRequestOptions {
  /** This process's own identity. Signs the message. */
  sender: SabclPrivateIdentity;
  /** The recipient's public identity. Determines who can decrypt. */
  recipient: SabclPublicIdentity;
  /** Opaque route token; the router resolves it to a destination. */
  routeToken: string;
  /** Business payload. Encrypted; never visible to the router. */
  payload: unknown;
  ttlSeconds?: number;
  hopLimit?: number;
  /** Injected for deterministic tests. Unix seconds. */
  now?: number;
}

export interface SealedRequest {
  envelope: SabclEnvelope;
  /** Kept by the sender to open the response. Never transmitted. */
  responseSecret: Buffer;
}

function nowSeconds(now?: number): number {
  return now ?? Math.floor(Date.now() / 1000);
}

export function sealRequest(options: SealRequestOptions): SealedRequest {
  const issuedAt = nowSeconds(options.now);
  const ttl = options.ttlSeconds ?? SABCL_DEFAULT_TTL_SECONDS;
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > SABCL_MAX_TTL_SECONDS) {
    throw new SabclError('SABCL_MALFORMED', 'ttl out of range');
  }
  const hopLimit = options.hopLimit ?? SABCL_DEFAULT_HOP_LIMIT;
  if (
    !Number.isSafeInteger(hopLimit) ||
    hopLimit < 1 ||
    hopLimit > SABCL_MAX_HOP_LIMIT
  ) {
    throw new SabclError('SABCL_MALFORMED', 'hop limit out of range');
  }
  if (options.recipient.revoked) {
    throw new SabclError('SABCL_KEY_REVOKED', 'recipient key is revoked');
  }
  if (
    options.sender.notAfter !== undefined &&
    issuedAt > options.sender.notAfter
  ) {
    throw new SabclError('SABCL_KEY_REVOKED', 'sender key has expired');
  }

  const serialised = Buffer.from(JSON.stringify(options.payload), 'utf8');
  const { padded, bucket } = padPayload(serialised);

  const ephemeral = generateKeyPairSync('x25519');
  const nonce = newNonce();
  const header = {
    v: SABCL_PROTOCOL_VERSION,
    mid: randomId(SABCL_MESSAGE_ID_BYTES),
    rt: options.routeToken,
    skid: options.sender.keyId,
    rkid: options.recipient.keyId,
    epk: toBase64Url(exportRawPublicKey(ephemeral.publicKey)),
    iat: issuedAt,
    exp: issuedAt + ttl,
    n: toBase64Url(nonce),
    hl: hopLimit,
    pad: bucket,
  } as const;

  const aad = canonicalRequestHeader(header);
  const sharedSecret = deriveSharedSecret(
    ephemeral.privateKey,
    options.recipient.encryptionPublicKey,
  );
  const key = deriveKey(
    sharedSecret,
    nonce,
    canonicalEncode([SABCL_DOMAIN.requestKey, aad]),
  );
  const { ciphertext, tag } = aeadSeal(key, nonce, padded, aad);

  const signature = signBytes(
    options.sender.signingPrivateKey,
    canonicalEncode([SABCL_DOMAIN.requestSignature, aad, ciphertext, tag]),
  );

  const envelope = sabclEnvelopeSchema.parse({
    ...header,
    ct: toBase64Url(ciphertext),
    tag: toBase64Url(tag),
    sig: toBase64Url(signature),
  });

  return { envelope, responseSecret: sharedSecret };
}

export interface OpenRequestOptions {
  /** This process's own identity; must match `rkid`. */
  recipient: SabclPrivateIdentity;
  /** Accepted senders. Revocation and expiry are enforced here. */
  keyring: SabclKeyring;
  envelope: SabclEnvelope;
  now?: number;
}

export interface OpenedRequest<T = unknown> {
  payload: T;
  messageId: string;
  senderKeyId: string;
  senderService: string;
  routeToken: string;
  /** Shared secret for encrypting the response back to this sender. */
  responseSecret: Buffer;
}

export function openRequest<T = unknown>(
  options: OpenRequestOptions,
): OpenedRequest<T> {
  const { envelope, recipient, keyring } = options;
  const now = nowSeconds(options.now);

  if (envelope.v !== SABCL_PROTOCOL_VERSION) {
    throw new SabclError('SABCL_UNSUPPORTED_VERSION');
  }
  // Expiry and freshness are checked before any key material is touched, so an
  // expired message costs no cryptography.
  if (now > envelope.exp) {
    throw new SabclError('SABCL_EXPIRED');
  }
  if (envelope.iat > now + SABCL_CLOCK_SKEW_SECONDS) {
    throw new SabclError('SABCL_EXPIRED', 'issued in the future');
  }
  if (envelope.exp - envelope.iat > SABCL_MAX_TTL_SECONDS) {
    throw new SabclError('SABCL_MALFORMED', 'ttl exceeds ceiling');
  }
  if (envelope.rkid !== recipient.keyId) {
    // Addressed to a different key. This is the wrong-recipient case and must
    // not be distinguishable from a decryption failure by anything the caller
    // can observe beyond the code itself.
    throw new SabclError('SABCL_UNKNOWN_RECIPIENT');
  }

  const sender = keyring.peer(envelope.skid, now);

  const aad = canonicalRequestHeader({
    v: envelope.v,
    mid: envelope.mid,
    rt: envelope.rt,
    skid: envelope.skid,
    rkid: envelope.rkid,
    epk: envelope.epk,
    iat: envelope.iat,
    exp: envelope.exp,
    n: envelope.n,
    hl: envelope.hl,
    pad: envelope.pad,
  });

  const ciphertext = fromBase64Url(envelope.ct, 'ct');
  const tag = fromBase64Url(envelope.tag, 'tag');
  const signature = fromBase64Url(envelope.sig, 'sig');

  // Signature first: it is cheaper than a failed AEAD open and it is the check
  // that establishes *who* is talking, which the audit trail needs even when
  // decryption subsequently fails.
  if (
    !verifyBytes(
      sender.signingPublicKey,
      canonicalEncode([SABCL_DOMAIN.requestSignature, aad, ciphertext, tag]),
      signature,
    )
  ) {
    throw new SabclError('SABCL_SIGNATURE_INVALID');
  }

  const ephemeralPublic = importKey(envelope.epk, 'x25519-public', 'epk');
  const sharedSecret = deriveSharedSecret(
    recipient.encryptionPrivateKey,
    ephemeralPublic,
  );
  const nonce = fromBase64Url(envelope.n, 'n');
  const key = deriveKey(
    sharedSecret,
    nonce,
    canonicalEncode([SABCL_DOMAIN.requestKey, aad]),
  );
  const padded = aeadOpen(key, nonce, ciphertext, tag, aad);
  if (padded.length !== envelope.pad) {
    throw new SabclError('SABCL_MALFORMED', 'padding bucket mismatch');
  }

  let payload: T;
  try {
    payload = JSON.parse(unpadPayload(padded).toString('utf8')) as T;
  } catch (error) {
    if (error instanceof SabclError) throw error;
    throw new SabclError('SABCL_MALFORMED', 'payload is not JSON');
  }

  return {
    payload,
    messageId: envelope.mid,
    senderKeyId: envelope.skid,
    senderService: sender.service,
    routeToken: envelope.rt,
    responseSecret: sharedSecret,
  };
}

export interface SealResponseOptions {
  responder: SabclPrivateIdentity;
  /** From {@link OpenedRequest.responseSecret}. */
  responseSecret: Buffer;
  /** The request's message identifier. */
  correlationId: string;
  payload: unknown;
}

/**
 * Seals a reply.
 *
 * The response reuses the request's ECDH secret but a distinct HKDF domain tag
 * and a fresh nonce, so request and response keys are unrelated and neither can
 * be substituted for the other.
 */
export function sealResponse(
  options: SealResponseOptions,
): SabclResponseEnvelope {
  const serialised = Buffer.from(JSON.stringify(options.payload), 'utf8');
  const { padded, bucket } = padPayload(serialised);
  const nonce = newNonce();
  const header = {
    v: SABCL_PROTOCOL_VERSION,
    cid: options.correlationId,
    skid: options.responder.keyId,
    n: toBase64Url(nonce),
    pad: bucket,
  } as const;
  const aad = canonicalResponseHeader(header);
  const key = deriveKey(
    options.responseSecret,
    nonce,
    canonicalEncode([SABCL_DOMAIN.responseKey, aad]),
  );
  const { ciphertext, tag } = aeadSeal(key, nonce, padded, aad);
  const signature = signBytes(
    options.responder.signingPrivateKey,
    canonicalEncode([SABCL_DOMAIN.responseSignature, aad, ciphertext, tag]),
  );
  return sabclResponseEnvelopeSchema.parse({
    ...header,
    ct: toBase64Url(ciphertext),
    tag: toBase64Url(tag),
    sig: toBase64Url(signature),
  });
}

export interface OpenResponseOptions {
  /** The responder's public identity, to verify the signature. */
  responder: SabclPublicIdentity;
  /** From {@link SealedRequest.responseSecret}. */
  responseSecret: Buffer;
  /** The `mid` of the request this response must correspond to. */
  expectedCorrelationId: string;
  envelope: SabclResponseEnvelope;
}

export function openResponse<T = unknown>(options: OpenResponseOptions): T {
  const { envelope } = options;
  if (envelope.v !== SABCL_PROTOCOL_VERSION) {
    throw new SabclError('SABCL_UNSUPPORTED_VERSION');
  }
  // A response that does not correlate to the outstanding request is rejected
  // before any key is derived, which stops a swapped or replayed reply.
  if (envelope.cid !== options.expectedCorrelationId) {
    throw new SabclError('SABCL_MALFORMED', 'response correlation mismatch');
  }
  if (envelope.skid !== options.responder.keyId) {
    throw new SabclError('SABCL_UNKNOWN_SENDER', 'unexpected responder key');
  }

  const aad = canonicalResponseHeader({
    v: envelope.v,
    cid: envelope.cid,
    skid: envelope.skid,
    n: envelope.n,
    pad: envelope.pad,
  });
  const ciphertext = fromBase64Url(envelope.ct, 'ct');
  const tag = fromBase64Url(envelope.tag, 'tag');
  const signature = fromBase64Url(envelope.sig, 'sig');

  if (
    !verifyBytes(
      options.responder.signingPublicKey,
      canonicalEncode([SABCL_DOMAIN.responseSignature, aad, ciphertext, tag]),
      signature,
    )
  ) {
    throw new SabclError('SABCL_SIGNATURE_INVALID');
  }

  const nonce = fromBase64Url(envelope.n, 'n');
  const key = deriveKey(
    options.responseSecret,
    nonce,
    canonicalEncode([SABCL_DOMAIN.responseKey, aad]),
  );
  const padded = aeadOpen(key, nonce, ciphertext, tag, aad);
  if (padded.length !== envelope.pad) {
    throw new SabclError('SABCL_MALFORMED', 'padding bucket mismatch');
  }
  try {
    return JSON.parse(unpadPayload(padded).toString('utf8')) as T;
  } catch (error) {
    if (error instanceof SabclError) throw error;
    throw new SabclError('SABCL_MALFORMED', 'payload is not JSON');
  }
}
