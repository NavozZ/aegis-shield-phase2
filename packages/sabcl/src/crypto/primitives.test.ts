import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  aeadOpen,
  aeadSeal,
  deriveKey,
  deriveSharedSecret,
  exportRawPrivateKey,
  exportRawPublicKey,
  fromBase64Url,
  importKey,
  newNonce,
  signBytes,
  timingSafeBytesEqual,
  toBase64Url,
  verifyBytes,
} from './primitives.js';
import { SabclError } from '../protocol/errors.js';
import { SABCL_KEY_BYTES, SABCL_NONCE_BYTES } from '../protocol/version.js';
import { flipBit } from '../testing/tamper.js';

test('base64url decoding rejects non-canonical input', () => {
  // Buffer.from tolerates padding and stray characters, which would let two
  // wire strings decode to identical bytes and break signature binding.
  const canonical = toBase64Url(Buffer.from([1, 2, 3]));
  assert.deepEqual(fromBase64Url(canonical, 'x'), Buffer.from([1, 2, 3]));
  for (const bad of ['AQID=', 'AQ ID', 'AQID!', 'AQI+D', 'AQI/D', '']) {
    assert.throws(() => fromBase64Url(bad, 'x'), SabclError);
  }
});

test('timing-safe comparison handles unequal lengths without throwing', () => {
  const a = Buffer.from('aaaa');
  assert.equal(timingSafeBytesEqual(a, Buffer.from('aaaa')), true);
  assert.equal(timingSafeBytesEqual(a, Buffer.from('aaab')), false);
  assert.equal(timingSafeBytesEqual(a, Buffer.from('aa')), false);
  assert.equal(timingSafeBytesEqual(a, Buffer.alloc(0)), false);
});

test('nonces are fresh 96-bit values, never reused', () => {
  const seen = new Set<string>();
  for (let index = 0; index < 512; index += 1) {
    const nonce = newNonce();
    assert.equal(nonce.length, SABCL_NONCE_BYTES);
    const encoded = nonce.toString('hex');
    assert.equal(seen.has(encoded), false, 'nonce repeated');
    seen.add(encoded);
  }
});

test('key import round-trips raw X25519 material', () => {
  const pair = generateKeyPairSync('x25519');
  const importedPrivate = importKey(
    toBase64Url(exportRawPrivateKey(pair.privateKey)),
    'x25519-private',
    'k',
  );
  const importedPublic = importKey(
    toBase64Url(exportRawPublicKey(pair.publicKey)),
    'x25519-public',
    'k',
  );
  assert.deepEqual(
    exportRawPrivateKey(importedPrivate),
    exportRawPrivateKey(pair.privateKey),
  );
  assert.deepEqual(
    exportRawPublicKey(importedPublic),
    exportRawPublicKey(pair.publicKey),
  );
});

test('key import round-trips raw Ed25519 material', () => {
  const pair = generateKeyPairSync('ed25519');
  const importedPrivate = importKey(
    toBase64Url(exportRawPrivateKey(pair.privateKey)),
    'ed25519-private',
    'k',
  );
  const importedPublic = importKey(
    toBase64Url(exportRawPublicKey(pair.publicKey)),
    'ed25519-public',
    'k',
  );
  assert.deepEqual(
    exportRawPrivateKey(importedPrivate),
    exportRawPrivateKey(pair.privateKey),
  );
  assert.deepEqual(
    exportRawPublicKey(importedPublic),
    exportRawPublicKey(pair.publicKey),
  );
  // A signature made with the imported key must verify under the original.
  const message = Buffer.from('round trip');
  assert.equal(
    verifyBytes(pair.publicKey, message, signBytes(importedPrivate, message)),
    true,
  );
});

test('key import rejects wrong-length and malformed material', () => {
  assert.throws(
    () => importKey(toBase64Url(randomBytes(16)), 'x25519-private', 'k'),
    SabclError,
  );
  assert.throws(
    () => importKey('not base64url!!', 'ed25519-public', 'k'),
    SabclError,
  );
});

test('ECDH agrees in both directions and diverges for a third party', () => {
  const alice = generateKeyPairSync('x25519');
  const bob = generateKeyPairSync('x25519');
  const mallory = generateKeyPairSync('x25519');
  assert.deepEqual(
    deriveSharedSecret(alice.privateKey, bob.publicKey),
    deriveSharedSecret(bob.privateKey, alice.publicKey),
  );
  assert.notDeepEqual(
    deriveSharedSecret(alice.privateKey, bob.publicKey),
    deriveSharedSecret(alice.privateKey, mallory.publicKey),
  );
});

test('HKDF separates keys by salt and by info', () => {
  const secret = randomBytes(32);
  const salt = randomBytes(12);
  const base = deriveKey(secret, salt, Buffer.from('a'));
  assert.equal(base.length, SABCL_KEY_BYTES);
  assert.deepEqual(base, deriveKey(secret, salt, Buffer.from('a')));
  assert.notDeepEqual(base, deriveKey(secret, salt, Buffer.from('b')));
  assert.notDeepEqual(
    base,
    deriveKey(secret, randomBytes(12), Buffer.from('a')),
  );
});

test('AEAD round-trips and fails closed on any modification', () => {
  const key = randomBytes(32);
  const nonce = newNonce();
  const plaintext = Buffer.from('sensitive');
  const aad = Buffer.from('header');
  const { ciphertext, tag } = aeadSeal(key, nonce, plaintext, aad);
  assert.deepEqual(aeadOpen(key, nonce, ciphertext, tag, aad), plaintext);

  assert.throws(
    () => aeadOpen(key, nonce, flipBit(ciphertext), tag, aad),
    SabclError,
  );
  assert.throws(
    () => aeadOpen(key, nonce, ciphertext, flipBit(tag), aad),
    SabclError,
  );

  // Tampered additional data: the routing header changed under the ciphertext.
  assert.throws(
    () => aeadOpen(key, nonce, ciphertext, tag, Buffer.from('header!')),
    SabclError,
  );
  assert.throws(
    () => aeadOpen(randomBytes(32), nonce, ciphertext, tag, aad),
    SabclError,
  );
});

test('encrypting the same payload twice yields different ciphertext', () => {
  const key = randomBytes(32);
  const plaintext = Buffer.from('same every time');
  const aad = Buffer.from('h');
  const first = aeadSeal(key, newNonce(), plaintext, aad);
  const second = aeadSeal(key, newNonce(), plaintext, aad);
  assert.notDeepEqual(first.ciphertext, second.ciphertext);
});

test('Ed25519 signatures verify and reject tampering', () => {
  const pair = generateKeyPairSync('ed25519');
  const other = generateKeyPairSync('ed25519');
  const message = Buffer.from('signed material');
  const signature = signBytes(pair.privateKey, message);
  assert.equal(verifyBytes(pair.publicKey, message, signature), true);
  assert.equal(
    verifyBytes(pair.publicKey, Buffer.from('other'), signature),
    false,
  );
  assert.equal(verifyBytes(other.publicKey, message, signature), false);
  assert.equal(verifyBytes(pair.publicKey, message, randomBytes(64)), false);
  // Malformed signature length must return false, not throw.
  assert.equal(verifyBytes(pair.publicKey, message, Buffer.alloc(3)), false);
});
