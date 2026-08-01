import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  BACKUP_HEADER_BYTES,
  BackupCryptoError,
  canonicalManifestBytes,
  decryptBackupFile,
  encryptBackupFile,
  generateBackupKey,
  parseBackupKey,
  sha256Hex,
  verifyChecksum,
} from './backup-crypto.js';

const key = Buffer.alloc(32, 7);
const other = Buffer.alloc(32, 9);
const plaintext = Buffer.from('PGDMP synthetic dump contents for the drill');

function expectCode(run: () => unknown, code: string) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof BackupCryptoError, String(error));
    assert.equal(error.code, code);
    return true;
  });
}

test('a backup file round-trips under the correct key', () => {
  const file = encryptBackupFile(plaintext, key);
  assert.deepEqual(decryptBackupFile(file, key), plaintext);
});

test('every file uses a fresh nonce, so ciphertext never repeats', () => {
  const nonces = new Set<string>();
  const ciphertexts = new Set<string>();
  for (let index = 0; index < 200; index += 1) {
    const file = encryptBackupFile(plaintext, key);
    // Nonce sits immediately after the 9-byte magic and version.
    nonces.add(file.subarray(9, 21).toString('hex'));
    ciphertexts.add(file.toString('hex'));
  }
  assert.equal(nonces.size, 200, 'a nonce repeated');
  assert.equal(
    ciphertexts.size,
    200,
    'identical plaintext produced identical file',
  );
});

test('the wrong key is rejected rather than producing garbage', () => {
  const file = encryptBackupFile(plaintext, key);
  expectCode(() => decryptBackupFile(file, other), 'DECRYPTION_FAILED');
});

test('tampered ciphertext is rejected', () => {
  const file = encryptBackupFile(plaintext, key);
  for (const index of [BACKUP_HEADER_BYTES, file.length - 1]) {
    const tampered = Buffer.from(file);
    tampered[index] = (tampered[index] as number) ^ 0x01;
    expectCode(() => decryptBackupFile(tampered, key), 'DECRYPTION_FAILED');
  }
});

test('a tampered authentication tag or nonce is rejected', () => {
  const file = encryptBackupFile(plaintext, key);
  for (const index of [10, 22]) {
    const tampered = Buffer.from(file);
    tampered[index] = (tampered[index] as number) ^ 0x01;
    expectCode(() => decryptBackupFile(tampered, key), 'DECRYPTION_FAILED');
  }
});

test('a tampered header is rejected before decryption is attempted', () => {
  const file = encryptBackupFile(plaintext, key);
  const badMagic = Buffer.from(file);
  badMagic[0] = (badMagic[0] as number) ^ 0x01;
  expectCode(() => decryptBackupFile(badMagic, key), 'FORMAT_INVALID');

  const badVersion = Buffer.from(file);
  badVersion[8] = 99;
  expectCode(() => decryptBackupFile(badVersion, key), 'FORMAT_INVALID');
});

test('a truncated file is rejected', () => {
  const file = encryptBackupFile(plaintext, key);
  expectCode(() => decryptBackupFile(file.subarray(0, 5), key), 'TRUNCATED');
  expectCode(
    () => decryptBackupFile(file.subarray(0, BACKUP_HEADER_BYTES - 1), key),
    'TRUNCATED',
  );
  // Losing the tail of the ciphertext must fail authentication, not truncate
  // the restored dump.
  expectCode(
    () => decryptBackupFile(file.subarray(0, file.length - 4), key),
    'DECRYPTION_FAILED',
  );
});

test('the ciphertext does not contain the plaintext', () => {
  const file = encryptBackupFile(plaintext, key);
  assert.equal(file.includes(plaintext), false);
  assert.equal(file.toString('latin1').includes('synthetic dump'), false);
});

test('key parsing accepts exactly 32 bytes of base64', () => {
  const generated = generateBackupKey();
  assert.equal(parseBackupKey(generated).length, 32);
  assert.equal(
    parseBackupKey(randomBytes(32).toString('base64url')).length,
    32,
  );
});

test('weak, malformed and absent keys are refused', () => {
  for (const bad of [
    undefined,
    '',
    '   ',
    randomBytes(16).toString('base64'),
    randomBytes(64).toString('base64'),
    'not base64 !!',
    Buffer.alloc(32).toString('base64'),
  ]) {
    expectCode(() => parseBackupKey(bad), 'KEY_INVALID');
  }
});

test('encrypting or decrypting with a wrong-length key is refused', () => {
  expectCode(
    () => encryptBackupFile(plaintext, Buffer.alloc(16)),
    'KEY_INVALID',
  );
  expectCode(
    () =>
      decryptBackupFile(encryptBackupFile(plaintext, key), Buffer.alloc(16)),
    'KEY_INVALID',
  );
});

test('checksum verification is exact', () => {
  const file = encryptBackupFile(plaintext, key);
  verifyChecksum(file, sha256Hex(file));
  expectCode(() => verifyChecksum(file, 'a'.repeat(64)), 'CHECKSUM_MISMATCH');
  expectCode(
    () => verifyChecksum(file, sha256Hex(file).slice(0, 63)),
    'CHECKSUM_MISMATCH',
  );
});

test('manifest canonicalisation is order independent', () => {
  const left = canonicalManifestBytes({ b: 1, a: { d: 2, c: 3 } });
  const right = canonicalManifestBytes({ a: { c: 3, d: 2 }, b: 1 });
  assert.deepEqual(left, right);
  assert.equal(sha256Hex(left), sha256Hex(right));
  // A changed value must change the checksum.
  assert.notEqual(
    sha256Hex(canonicalManifestBytes({ a: 1 })),
    sha256Hex(canonicalManifestBytes({ a: 2 })),
  );
});

test('an empty dump still encrypts and authenticates', () => {
  const file = encryptBackupFile(Buffer.alloc(0), key);
  assert.deepEqual(decryptBackupFile(file, key), Buffer.alloc(0));
});
