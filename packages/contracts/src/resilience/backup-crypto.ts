import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/*
 * Backup file encryption.
 *
 * This lives in the shared contracts package because both the operator tooling
 * that writes backup sets and the verification tooling that reads them must
 * agree byte-for-byte on the format. Nothing here invents a construction: it is
 * AES-256-GCM from Node's `node:crypto`, used in its standard shape.
 *
 * File layout:
 *
 *   magic (8) ‖ version (1) ‖ nonce (12) ‖ tag (16) ‖ ciphertext
 *
 * The magic and version are authenticated as additional data, so a file cannot
 * be replayed as a different format version, and a truncated or reordered
 * header fails authentication rather than being interpreted.
 */

/** `AEGISBK1` — identifies the format before anything is decrypted. */
export const BACKUP_MAGIC = Buffer.from('AEGISBK1', 'ascii');
export const BACKUP_FORMAT_VERSION = 1;

export const BACKUP_KEY_BYTES = 32;
export const BACKUP_NONCE_BYTES = 12;
export const BACKUP_TAG_BYTES = 16;
export const BACKUP_HEADER_BYTES =
  BACKUP_MAGIC.length + 1 + BACKUP_NONCE_BYTES + BACKUP_TAG_BYTES;

export class BackupCryptoError extends Error {
  constructor(
    readonly code:
      | 'KEY_INVALID'
      | 'FORMAT_INVALID'
      | 'TRUNCATED'
      | 'DECRYPTION_FAILED'
      | 'CHECKSUM_MISMATCH',
    detail?: string,
  ) {
    // The message is the code alone. Detail is for local diagnosis and is never
    // interpolated into anything that could reach a log or an operator surface.
    super(code);
    this.name = 'BackupCryptoError';
    if (detail) this.detail = detail;
  }
  detail?: string;
}

/**
 * Parses and validates the backup encryption key.
 *
 * Exactly 32 bytes, base64 or base64url. A short or malformed key is rejected
 * rather than stretched: silently deriving a key from a weak secret would make
 * a weak configuration look like a working one.
 */
export function parseBackupKey(raw: string | undefined): Buffer {
  const value = raw?.trim();
  if (!value) {
    throw new BackupCryptoError('KEY_INVALID', 'key is absent');
  }
  if (/^[A-Za-z0-9+/=_-]+$/u.test(value) === false) {
    throw new BackupCryptoError('KEY_INVALID', 'key is not base64');
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== BACKUP_KEY_BYTES) {
    throw new BackupCryptoError(
      'KEY_INVALID',
      `key must decode to ${BACKUP_KEY_BYTES} bytes`,
    );
  }
  // An all-zero key is a placeholder someone forgot to replace, not a secret.
  if (timingSafeEqual(key, Buffer.alloc(BACKUP_KEY_BYTES))) {
    throw new BackupCryptoError('KEY_INVALID', 'key is all zero bytes');
  }
  return key;
}

/** Generates a fresh key, for documentation and local setup only. */
export function generateBackupKey(): string {
  return randomBytes(BACKUP_KEY_BYTES).toString('base64');
}

/** Hex SHA-256, used for manifest and file checksums. */
export function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Encrypts one dump.
 *
 * A fresh 96-bit nonce per file: reusing a nonce under one key would leak the
 * XOR of two plaintexts, and backup sets are written repeatedly under the same
 * key by design.
 */
export function encryptBackupFile(plaintext: Buffer, key: Buffer): Buffer {
  if (key.length !== BACKUP_KEY_BYTES) {
    throw new BackupCryptoError('KEY_INVALID');
  }
  const nonce = randomBytes(BACKUP_NONCE_BYTES);
  const header = Buffer.concat([
    BACKUP_MAGIC,
    Buffer.from([BACKUP_FORMAT_VERSION]),
  ]);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, {
    authTagLength: BACKUP_TAG_BYTES,
  });
  cipher.setAAD(header);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([header, nonce, cipher.getAuthTag(), ciphertext]);
}

/**
 * Decrypts one dump.
 *
 * Every failure mode — wrong key, tampered ciphertext, tampered header,
 * truncation — surfaces as a distinct code so the tooling can report which
 * check failed, while none of them reveals anything about the plaintext.
 */
export function decryptBackupFile(file: Buffer, key: Buffer): Buffer {
  if (key.length !== BACKUP_KEY_BYTES) {
    throw new BackupCryptoError('KEY_INVALID');
  }
  if (file.length < BACKUP_HEADER_BYTES) {
    throw new BackupCryptoError('TRUNCATED', 'file is shorter than its header');
  }
  const magic = file.subarray(0, BACKUP_MAGIC.length);
  if (!timingSafeEqual(magic, BACKUP_MAGIC)) {
    throw new BackupCryptoError('FORMAT_INVALID', 'unexpected magic');
  }
  const version = file[BACKUP_MAGIC.length];
  if (version !== BACKUP_FORMAT_VERSION) {
    throw new BackupCryptoError('FORMAT_INVALID', 'unsupported format version');
  }
  let offset = BACKUP_MAGIC.length + 1;
  const nonce = file.subarray(offset, offset + BACKUP_NONCE_BYTES);
  offset += BACKUP_NONCE_BYTES;
  const tag = file.subarray(offset, offset + BACKUP_TAG_BYTES);
  offset += BACKUP_TAG_BYTES;
  const ciphertext = file.subarray(offset);

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, {
      authTagLength: BACKUP_TAG_BYTES,
    });
    decipher.setAAD(file.subarray(0, BACKUP_MAGIC.length + 1));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // A wrong key and a tampered file are indistinguishable here, which is the
    // correct behaviour for an authenticated cipher.
    throw new BackupCryptoError('DECRYPTION_FAILED');
  }
}

/** Verifies a file against its recorded checksum before any decryption. */
export function verifyChecksum(file: Buffer, expected: string): void {
  const actual = sha256Hex(file);
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new BackupCryptoError('CHECKSUM_MISMATCH');
  }
}

/**
 * Canonical manifest bytes for checksumming and signing.
 *
 * Keys are sorted so the same manifest always produces the same checksum
 * regardless of how the object was built.
 */
export function canonicalManifestBytes(manifest: unknown): Buffer {
  const sort = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sort)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .filter(([, item]) => item !== undefined)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, item]) => [key, sort(item)]),
          )
        : value;
  return Buffer.from(JSON.stringify(sort(manifest)), 'utf8');
}
