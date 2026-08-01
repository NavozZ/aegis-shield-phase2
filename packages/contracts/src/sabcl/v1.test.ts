import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sabclKeyFingerprintSchema,
  sabclRouterStatusSchema,
  sabclStatusResponseSchema,
} from './v1.js';

const router = {
  protocolVersion: 'SABCL/1',
  mode: 'strict' as const,
  strict: true,
  routerKey: 'sabcl-router.v1:44ab02',
  rotation: [
    {
      service: 'ledger',
      active: 'ledger.v2',
      accepted: ['ledger.v1', 'ledger.v2'],
      revoked: [],
    },
  ],
  routes: ['ledger.accounts'],
  reachability: [
    { routeId: 'ledger.accounts', service: 'ledger', reachable: true },
  ],
  padding: { policy: 'bucketed', unit: 'bytes' },
  counters: { 'envelope.accepted': 3 },
  replayState: 'ok' as const,
};

const status = {
  protocolVersion: 'SABCL/1',
  mode: 'strict' as const,
  strict: true,
  gatewayKey: 'gateway.v1:9f3c1a',
  peerKeyIds: ['ledger.v1'],
  routerReachable: true,
  router,
};

test('the documented status shape is accepted', () => {
  assert.equal(sabclStatusResponseSchema.safeParse(status).success, true);
  assert.equal(
    sabclStatusResponseSchema.safeParse({
      ...status,
      routerReachable: false,
      router: null,
    }).success,
    true,
  );
});

test('key fields accept an abbreviated fingerprint and nothing longer', () => {
  assert.equal(
    sabclKeyFingerprintSchema.safeParse('ledger.v2:9f3c1a').success,
    true,
  );
  assert.equal(sabclKeyFingerprintSchema.safeParse('ledger.v2').success, true);
  // A raw 32-byte key is 43 base64url characters. It matches no fingerprint
  // pattern, so key material cannot pass this contract even by mistake.
  assert.equal(
    sabclKeyFingerprintSchema.safeParse(
      Buffer.alloc(32, 7).toString('base64url'),
    ).success,
    false,
  );
  for (const bad of [
    'ledger.v2:9F3C1A',
    'ledger.v2:9f3c1',
    'ledger.v2:' + 'a'.repeat(64),
    'Ledger.v2',
    '/internal/customers',
  ]) {
    assert.equal(sabclKeyFingerprintSchema.safeParse(bad).success, false, bad);
  }
});

test('an unexpected field is a parse failure, not a silent passthrough', () => {
  // This is what makes the contract a control rather than documentation.
  for (const extra of [
    { routeSecret: 'AAAA' },
    { privateKey: 'BBBB' },
    { payload: { customerId: 'cus_1' } },
    { destinations: ['http://127.0.0.1:4102'] },
  ]) {
    assert.equal(
      sabclStatusResponseSchema.safeParse({ ...status, ...extra }).success,
      false,
      JSON.stringify(extra),
    );
    assert.equal(
      sabclRouterStatusSchema.safeParse({ ...router, ...extra }).success,
      false,
      JSON.stringify(extra),
    );
  }
});

test('mode and replay state are closed enumerations', () => {
  assert.equal(
    sabclStatusResponseSchema.safeParse({ ...status, mode: 'simulation' })
      .success,
    false,
  );
  assert.equal(
    sabclRouterStatusSchema.safeParse({ ...router, replayState: 'probably' })
      .success,
    false,
  );
});

test('counters are non-negative integers', () => {
  for (const counters of [{ a: -1 }, { a: 1.5 }, { a: 'many' }]) {
    assert.equal(
      sabclRouterStatusSchema.safeParse({ ...router, counters }).success,
      false,
    );
  }
});

test('collections are bounded so a status document cannot grow unbounded', () => {
  assert.equal(
    sabclRouterStatusSchema.safeParse({
      ...router,
      routes: Array.from({ length: 100 }, (_, index) => `svc.route${index}`),
    }).success,
    false,
  );
});
