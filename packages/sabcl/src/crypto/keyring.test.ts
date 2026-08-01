import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SabclKeyring,
  abbreviateKey,
  serviceOfKeyId,
  versionOfKeyId,
} from './keyring.js';
import { SabclError, type SabclErrorCode } from '../protocol/errors.js';
import {
  fixtureIdentityMaterial,
  fixtureKeyring,
  fixturePrivateIdentity,
  fixturePublicIdentity,
} from '../testing/fixtures.js';
import { exportRawPublicKey } from './primitives.js';

const NOW = 1_800_000_000;

function expectCode(run: () => unknown, code: SabclErrorCode) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof SabclError);
    assert.equal(error.code, code);
    return true;
  });
}

test('key identifiers parse into service and rotation version', () => {
  assert.equal(serviceOfKeyId('api-gateway.v3'), 'api-gateway');
  assert.equal(versionOfKeyId('api-gateway.v3'), 3);
  expectCode(() => serviceOfKeyId('nope'), 'SABCL_MALFORMED');
  expectCode(() => serviceOfKeyId('Gateway.v1'), 'SABCL_MALFORMED');
});

test('signing and encryption identities are distinct key pairs', () => {
  const identity = fixturePrivateIdentity('gateway');
  assert.notDeepEqual(
    exportRawPublicKey(identity.encryptionPublicKey),
    exportRawPublicKey(identity.signingPublicKey),
  );
  assert.equal(identity.encryptionPrivateKey.asymmetricKeyType, 'x25519');
  assert.equal(identity.signingPrivateKey.asymmetricKeyType, 'ed25519');
});

test('the public half is derived from the private half, so they cannot disagree', () => {
  const material = fixtureIdentityMaterial('gateway');
  const identity = fixturePrivateIdentity('gateway');
  assert.equal(
    exportRawPublicKey(identity.signingPublicKey).toString('base64url'),
    material.signingPublicKey,
  );
  assert.equal(
    exportRawPublicKey(identity.encryptionPublicKey).toString('base64url'),
    material.encryptionPublicKey,
  );
});

test('lookup honours revocation and expiry', () => {
  const keyring = fixtureKeyring('ledger', [
    { service: 'gateway', version: 1 },
    { service: 'payments', version: 1, revoked: true },
    { service: 'identity', version: 1, notAfter: NOW - 1 },
  ]);
  assert.equal(keyring.peer('gateway.v1', NOW).service, 'gateway');
  expectCode(() => keyring.peer('payments.v1', NOW), 'SABCL_KEY_REVOKED');
  expectCode(() => keyring.peer('identity.v1', NOW), 'SABCL_KEY_REVOKED');
  expectCode(() => keyring.peer('unknown.v1', NOW), 'SABCL_UNKNOWN_SENDER');
});

test('the active key for a service is the highest live version', () => {
  const keyring = fixtureKeyring('gateway', [
    { service: 'ledger', version: 1 },
    { service: 'ledger', version: 2 },
    { service: 'ledger', version: 3, revoked: true },
  ]);
  // v3 is revoked, so senders address v2 while v1 is still accepted inbound.
  assert.equal(keyring.activePeerFor('ledger', NOW).keyId, 'ledger.v2');
  assert.equal(keyring.peer('ledger.v1', NOW).keyId, 'ledger.v1');
});

test('a service with no live key cannot be addressed', () => {
  const keyring = fixtureKeyring('gateway', [
    { service: 'ledger', version: 1, revoked: true },
  ]);
  expectCode(
    () => keyring.activePeerFor('ledger', NOW),
    'SABCL_UNKNOWN_RECIPIENT',
  );
});

test('duplicate peer entries are refused at construction', () => {
  assert.throws(
    () =>
      new SabclKeyring(fixturePrivateIdentity('gateway'), [
        fixturePublicIdentity('ledger'),
        fixturePublicIdentity('ledger'),
      ]),
    SabclError,
  );
});

test('rotation state describes active, accepted and revoked keys', () => {
  const keyring = fixtureKeyring('gateway', [
    { service: 'ledger', version: 1 },
    { service: 'ledger', version: 2 },
    { service: 'payments', version: 1, revoked: true },
  ]);
  assert.deepEqual(keyring.rotationState(NOW), [
    {
      service: 'ledger',
      active: 'ledger.v2',
      accepted: ['ledger.v1', 'ledger.v2'],
      revoked: [],
    },
    {
      service: 'payments',
      active: null,
      accepted: [],
      revoked: ['payments.v1'],
    },
  ]);
});

test('operator abbreviations identify a key without publishing it', () => {
  const identity = fixturePrivateIdentity('gateway');
  const abbreviated = abbreviateKey(identity);
  assert.match(abbreviated, /^gateway\.v1:[0-9a-f]{6}$/u);
  // Six hex characters is three bytes of a 32-byte key: enough to compare two
  // deployments, far too little to reconstruct the key.
  const full = exportRawPublicKey(identity.signingPublicKey).toString(
    'base64url',
  );
  assert.equal(abbreviated.includes(full), false);
});

test('no private key material appears in any operator-facing view', () => {
  const keyring = fixtureKeyring('gateway', ['ledger']);
  const material = fixtureIdentityMaterial('gateway');
  const views = JSON.stringify([
    keyring.peerKeyIds(),
    keyring.rotationState(NOW),
    abbreviateKey(keyring.own),
  ]);
  assert.equal(views.includes(material.signingPrivateKey), false);
  assert.equal(views.includes(material.encryptionPrivateKey), false);
});
