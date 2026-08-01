import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SABCL_CAPABILITIES,
  capabilitiesForService,
  routeIdsForService,
} from './capabilities.js';
import { assertRouteId } from '../protocol/route-token.js';

/** Every pattern across every capability. */
const allPatterns = Object.values(SABCL_CAPABILITIES).flatMap(
  (entry) => entry.capability.pathPatterns,
);

function matchesAnywhere(path: string): boolean {
  return allPatterns.some((pattern) => pattern.test(path));
}

test('every route identifier is a valid capability name, not a path', () => {
  for (const entry of Object.values(SABCL_CAPABILITIES)) {
    assert.equal(assertRouteId(entry.routeId), entry.routeId);
    assert.equal(entry.routeId.includes('/'), false);
  }
});

test('every pattern is anchored at both ends', () => {
  // An unanchored pattern would match a longer hostile path that merely
  // contains an allowed one.
  for (const pattern of allPatterns) {
    assert.ok(
      pattern.source.startsWith('^'),
      `${pattern.source} is not anchored`,
    );
    assert.ok(
      pattern.source.endsWith('$'),
      `${pattern.source} is not anchored`,
    );
  }
});

test('the paths the gateway legitimately uses are allowed', () => {
  for (const path of [
    '/api/v1/auth/transfer-step-up',
    '/api/v1/auth/session',
    '/internal/customer-accounts/default',
    '/internal/customers/cus_123/accounts',
    '/internal/customer-accounts/acc_456',
    '/internal/customer-accounts/acc_456/balance',
    '/internal/customer-accounts/acc_456/transactions',
    '/internal/customer-accounts/acc_456/transactions?limit=20&cursor=abc',
    '/internal/customer-accounts/acc_456/transactions/txn_789',
    '/internal/customer-transfers/preview',
    '/internal/customer-transfers',
    '/internal/transfer-policy',
    '/internal/transfer-intents',
    '/internal/transfer-intents/tok_abc/authorize',
    '/internal/transfers',
    '/internal/customers/cus_123/transfers',
    '/internal/customers/cus_123/transfers/trf_1',
  ]) {
    assert.equal(matchesAnywhere(path), true, `${path} should be reachable`);
  }
});

test('paths outside the catalogue are refused by every capability', () => {
  for (const path of [
    // Administrative and reconciliation surfaces are deliberately absent: a
    // SABCL caller has no route to them.
    '/internal/reconciliation',
    '/internal/reconciliation/latest',
    '/internal/recovery/run',
    '/internal/journal-entries',
    // Authentication surfaces that must stay browser-only.
    '/api/v1/auth/onboarding/create-pin',
    '/api/v1/auth/fallback/login',
    '/api/v1/auth/logout',
    '/api/v1/auth/passkeys/registration/verify',
    // Traversal and origin games.
    '/internal/customers/../reconciliation/accounts',
    '//evil.test/internal/customers/cus_1/accounts',
    '/internal/customers/cus_1/accounts/../../journal-entries',
    '/health/ready',
    '/',
  ]) {
    assert.equal(matchesAnywhere(path), false, `${path} must not be reachable`);
  }
});

test('a read capability cannot reach a posting path and vice versa', () => {
  // Separating ledger.accounts from ledger.postings only means something if the
  // patterns really are disjoint.
  const reads = SABCL_CAPABILITIES['ledger.accounts'].capability;
  const postings = SABCL_CAPABILITIES['ledger.postings'].capability;
  assert.equal(
    reads.pathPatterns.some((p) => p.test('/internal/customer-transfers')),
    false,
  );
  assert.equal(
    postings.pathPatterns.some((p) =>
      p.test('/internal/customers/cus_1/accounts'),
    ),
    false,
  );
  assert.deepEqual(postings.methods, ['POST']);
});

test('identifier segments cannot contain a path separator', () => {
  for (const path of [
    '/internal/customers/cus_1%2f..%2fadmin/accounts',
    '/internal/customer-accounts/acc/1/balance',
    '/internal/transfer-intents/tok/../x/authorize',
  ]) {
    assert.equal(matchesAnywhere(path), false, path);
  }
});

test('service lookups partition the catalogue without gaps', () => {
  assert.deepEqual(routeIdsForService('ledger').sort(), [
    'ledger.accounts',
    'ledger.postings',
  ]);
  assert.deepEqual(routeIdsForService('payments'), ['payments.transfer']);
  assert.deepEqual(routeIdsForService('identity'), ['identity.step-up']);
  assert.equal(capabilitiesForService('ledger').length, 2);
  assert.equal(capabilitiesForService('nobody').length, 0);

  const total = Object.keys(SABCL_CAPABILITIES).length;
  const partitioned = ['identity', 'ledger', 'payments'].reduce(
    (sum, service) => sum + routeIdsForService(service).length,
    0,
  );
  assert.equal(
    partitioned,
    total,
    'every capability belongs to a known service',
  );
});
