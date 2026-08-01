import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { loadSabclEnvironment, resolveMode } from './environment.js';
import { SabclError, type SabclErrorCode } from '../protocol/errors.js';
import {
  FIXTURE_ROUTE_SECRET,
  fixtureIdentityMaterial,
  isFixtureMaterial,
} from '../testing/fixtures.js';

const gateway = fixtureIdentityMaterial('gateway');
const ledger = fixtureIdentityMaterial('ledger');
const REAL_LOOKING_SECRET = randomBytes(32).toString('base64url');

function input(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'compatible',
    keyId: gateway.keyId,
    encryptionPrivateKey: gateway.encryptionPrivateKey,
    signingPrivateKey: gateway.signingPrivateKey,
    peers: JSON.stringify([
      {
        keyId: ledger.keyId,
        encryptionPublicKey: ledger.encryptionPublicKey,
        signingPublicKey: ledger.signingPublicKey,
      },
    ]),
    routeSecret: REAL_LOOKING_SECRET,
    nodeEnvironment: 'test',
    ...overrides,
  };
}

function expectCode(run: () => unknown, code: SabclErrorCode) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof SabclError, String(error));
    assert.equal(error.code, code);
    return true;
  });
}

test('mode resolution accepts the three documented modes and nothing else', () => {
  assert.equal(resolveMode(undefined), 'off');
  assert.equal(resolveMode('strict'), 'strict');
  assert.equal(resolveMode('compatible'), 'compatible');
  assert.equal(resolveMode('off'), 'off');
  // "simulation" was the placeholder value in .env.example before this phase;
  // it must not silently resolve to anything.
  expectCode(() => resolveMode('simulation'), 'SABCL_NOT_CONFIGURED');
  expectCode(() => resolveMode('Strict'), 'SABCL_NOT_CONFIGURED');
});

test('mode off needs no configuration at all', () => {
  assert.equal(
    loadSabclEnvironment({
      mode: 'off',
      keyId: undefined,
      encryptionPrivateKey: undefined,
      signingPrivateKey: undefined,
      peers: undefined,
      routeSecret: undefined,
      nodeEnvironment: 'production',
    }),
    null,
  );
});

test('a valid configuration builds a keyring and route secret', () => {
  const environment = loadSabclEnvironment(input());
  assert.ok(environment);
  assert.equal(environment.mode, 'compatible');
  assert.equal(environment.keyring.own.keyId, 'gateway.v1');
  assert.deepEqual(environment.keyring.peerKeyIds(), ['ledger.v1']);
  assert.equal(environment.routeSecret.length, 32);
});

test('strict mode fails startup when required material is absent', () => {
  for (const missing of [
    'keyId',
    'encryptionPrivateKey',
    'signingPrivateKey',
    'peers',
    'routeSecret',
  ]) {
    expectCode(
      () =>
        loadSabclEnvironment(input({ mode: 'strict', [missing]: undefined })),
      'SABCL_NOT_CONFIGURED',
    );
  }
});

test('strict mode refuses deterministic fixture key material', () => {
  // The fixture keys are raw base64url of a hash, so they look exactly like real
  // random material. Detection has to recompute them, not pattern-match them —
  // this test is what proves the check is real rather than decorative.
  expectCode(
    () => loadSabclEnvironment(input({ mode: 'strict' })),
    'SABCL_NOT_CONFIGURED',
  );
  // Either half being a fixture is enough to refuse startup.
  expectCode(
    () =>
      loadSabclEnvironment(
        input({
          mode: 'strict',
          encryptionPrivateKey: randomBytes(32).toString('base64url'),
        }),
      ),
    'SABCL_NOT_CONFIGURED',
  );
  expectCode(
    () =>
      loadSabclEnvironment(
        input({
          mode: 'strict',
          signingPrivateKey: randomBytes(32).toString('base64url'),
        }),
      ),
    'SABCL_NOT_CONFIGURED',
  );
});

test('strict mode refuses the fixture route secret', () => {
  expectCode(
    () =>
      loadSabclEnvironment(
        input({
          mode: 'strict',
          encryptionPrivateKey: randomBytes(32).toString('base64url'),
          signingPrivateKey: randomBytes(32).toString('base64url'),
          routeSecret: FIXTURE_ROUTE_SECRET.toString('base64url'),
        }),
      ),
    'SABCL_NOT_CONFIGURED',
  );
});

test('the fixture detector does not fire on genuinely random material', () => {
  assert.equal(
    isFixtureMaterial({
      keyId: 'gateway.v1',
      encryptionPrivateKey: randomBytes(32).toString('base64url'),
      signingPrivateKey: randomBytes(32).toString('base64url'),
      routeSecret: randomBytes(32).toString('base64url'),
    }),
    false,
  );
  // ...and does fire on a fixture for any service name, without a denylist.
  for (const service of [
    'gateway',
    'ledger',
    'payments',
    'identity',
    'novel-service',
  ]) {
    const material = fixtureIdentityMaterial(service, 7);
    assert.equal(isFixtureMaterial(material), true, service);
  }
});

test('strict mode refuses human placeholder values', () => {
  expectCode(
    () =>
      loadSabclEnvironment(
        input({ mode: 'strict', routeSecret: 'example-only-not-a-secret' }),
      ),
    'SABCL_NOT_CONFIGURED',
  );
  expectCode(
    () =>
      loadSabclEnvironment(
        input({ mode: 'strict', signingPrivateKey: 'local-only-change-me' }),
      ),
    'SABCL_NOT_CONFIGURED',
  );
});

test('strict mode accepts material that looks like real key material', () => {
  const real = {
    encryptionPrivateKey: randomBytes(32).toString('base64url'),
    signingPrivateKey: randomBytes(32).toString('base64url'),
  };
  const environment = loadSabclEnvironment(input({ mode: 'strict', ...real }));
  assert.ok(environment);
  assert.equal(environment.mode, 'strict');
});

test('compatible mode is refused in production so it cannot become a downgrade', () => {
  expectCode(
    () =>
      loadSabclEnvironment(
        input({ mode: 'compatible', nodeEnvironment: 'production' }),
      ),
    'SABCL_NOT_CONFIGURED',
  );
});

test('an undersized route secret is refused', () => {
  expectCode(
    () =>
      loadSabclEnvironment(
        input({ routeSecret: randomBytes(16).toString('base64url') }),
      ),
    'SABCL_NOT_CONFIGURED',
  );
});

test('invalid key material and peer lists are refused', () => {
  expectCode(
    () => loadSabclEnvironment(input({ encryptionPrivateKey: 'not-a-key' })),
    'SABCL_MALFORMED',
  );
  for (const peers of ['[]', 'not json', '[{"keyId":"ledger.v1"}]', '{}']) {
    assert.throws(() => loadSabclEnvironment(input({ peers })), SabclError);
  }
});

test('no private key material is present on the returned environment surface', () => {
  const environment = loadSabclEnvironment(input());
  assert.ok(environment);
  // KeyObject does not serialise its material, which is exactly why identities
  // are held as KeyObjects rather than as strings.
  const serialised = JSON.stringify(environment.keyring.own);
  assert.equal(serialised.includes(gateway.signingPrivateKey), false);
  assert.equal(serialised.includes(gateway.encryptionPrivateKey), false);
});
