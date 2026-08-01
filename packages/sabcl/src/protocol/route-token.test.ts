import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  SabclRouteTable,
  assertRouteId,
  deriveRouteToken,
} from './route-token.js';
import { SabclError, type SabclErrorCode } from './errors.js';
import { FIXTURE_ROUTE_SECRET } from '../testing/fixtures.js';

const ROUTES = [
  {
    routeId: 'ledger.accounts',
    service: 'ledger',
    destination: 'http://127.0.0.1:4102',
  },
  {
    routeId: 'payments.transfer',
    service: 'payments',
    destination: 'http://127.0.0.1:4104',
  },
  {
    routeId: 'identity.step-up',
    service: 'identity',
    destination: 'http://127.0.0.1:4101',
    revoked: true,
  },
];

const table = new SabclRouteTable(FIXTURE_ROUTE_SECRET, ROUTES);

function expectCode(run: () => unknown, code: SabclErrorCode) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof SabclError);
    assert.equal(error.code, code);
    return true;
  });
}

test('route tokens are deterministic for a given secret', () => {
  assert.equal(
    deriveRouteToken(FIXTURE_ROUTE_SECRET, 'ledger.accounts'),
    deriveRouteToken(FIXTURE_ROUTE_SECRET, 'ledger.accounts'),
  );
});

test('route tokens differ per route and per secret', () => {
  const other = randomBytes(32);
  assert.notEqual(
    deriveRouteToken(FIXTURE_ROUTE_SECRET, 'ledger.accounts'),
    deriveRouteToken(FIXTURE_ROUTE_SECRET, 'payments.transfer'),
  );
  assert.notEqual(
    deriveRouteToken(FIXTURE_ROUTE_SECRET, 'ledger.accounts'),
    deriveRouteToken(other, 'ledger.accounts'),
  );
});

test('a weak route secret is refused', () => {
  assert.throws(
    () => deriveRouteToken(Buffer.alloc(16), 'ledger.accounts'),
    SabclError,
  );
});

test('resolution maps a token to its allowlisted destination', () => {
  const resolved = table.resolve(
    deriveRouteToken(FIXTURE_ROUTE_SECRET, 'ledger.accounts'),
  );
  assert.deepEqual(resolved, {
    routeId: 'ledger.accounts',
    service: 'ledger',
    destination: 'http://127.0.0.1:4102',
  });
});

test('an unknown token has nowhere to resolve to', () => {
  // This is what stops the router being a generic proxy: an attacker-chosen
  // token is not a URL, it is a lookup miss.
  expectCode(
    () => table.resolve(randomBytes(32).toString('base64url')),
    'SABCL_ROUTE_INVALID',
  );
});

test('a revoked route is rejected and is indistinguishable from an unknown one', () => {
  const revoked = deriveRouteToken(FIXTURE_ROUTE_SECRET, 'identity.step-up');
  expectCode(() => table.resolve(revoked), 'SABCL_ROUTE_INVALID');
  expectCode(
    () => table.resolve(randomBytes(32).toString('base64url')),
    'SABCL_ROUTE_INVALID',
  );
});

test('a token derived under a different secret does not resolve', () => {
  expectCode(
    () => table.resolve(deriveRouteToken(randomBytes(32), 'ledger.accounts')),
    'SABCL_ROUTE_INVALID',
  );
});

test('malformed tokens are rejected without throwing a non-SABCL error', () => {
  for (const bad of ['', 'not base64!', '=====', 'a'.repeat(500)]) {
    expectCode(() => table.resolve(bad), 'SABCL_ROUTE_INVALID');
  }
});

test('route identifiers name capabilities, not paths', () => {
  assert.equal(assertRouteId('ledger.accounts'), 'ledger.accounts');
  for (const bad of [
    '/internal/customer-transfers',
    'Ledger.Accounts',
    'ledger',
    'ledger..accounts',
    'ledger accounts',
  ]) {
    expectCode(() => assertRouteId(bad), 'SABCL_ROUTE_INVALID');
  }
});

test('the route table refuses non-HTTP destinations and duplicates', () => {
  assert.throws(
    () =>
      new SabclRouteTable(FIXTURE_ROUTE_SECRET, [
        { routeId: 'a.b', service: 'a', destination: 'file:///etc/passwd' },
      ]),
    SabclError,
  );
  assert.throws(
    () =>
      new SabclRouteTable(FIXTURE_ROUTE_SECRET, [
        { routeId: 'a.b', service: 'a', destination: 'http://127.0.0.1:1' },
        { routeId: 'a.b', service: 'a', destination: 'http://127.0.0.1:2' },
      ]),
    SabclError,
  );
  assert.throws(
    () => new SabclRouteTable(FIXTURE_ROUTE_SECRET, []),
    SabclError,
  );
});

test('operator views expose route identifiers but never the tokens', () => {
  assert.deepEqual(table.liveRouteIds(), [
    'ledger.accounts',
    'payments.transfer',
  ]);
  const serialised = JSON.stringify(table.destinations());
  assert.equal(
    serialised.includes(
      deriveRouteToken(FIXTURE_ROUTE_SECRET, 'ledger.accounts'),
    ),
    false,
  );
});
