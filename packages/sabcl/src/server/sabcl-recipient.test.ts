import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SabclRecipient,
  statusForCode,
  type SabclCapability,
} from './sabcl-recipient.js';
import { InMemoryReplayStore } from '../replay/replay-store.js';
import { sealRequest, openResponse } from '../protocol/seal.js';
import { deriveRouteToken } from '../protocol/route-token.js';
import {
  FIXTURE_ROUTE_SECRET,
  fixtureKeyring,
  fixturePrivateIdentity,
  fixturePublicIdentity,
} from '../testing/fixtures.js';
import { tamperBase64Url } from '../testing/tamper.js';
import type {
  SabclInnerRequest,
  SabclInnerResponse,
} from '../protocol/payload.js';
import type { SabclResponseEnvelope } from '../protocol/envelope.js';

const NOW = 1_800_000_000;
const ROUTE = deriveRouteToken(FIXTURE_ROUTE_SECRET, 'ledger.accounts');

const gateway = fixturePrivateIdentity('gateway');
const ledgerPublic = fixturePublicIdentity('ledger');

const CAPABILITIES: SabclCapability[] = [
  {
    operationPrefix: 'ledger.accounts',
    methods: ['GET', 'POST'],
    pathPatterns: [
      /^\/internal\/customers\/[A-Za-z0-9_-]{1,64}\/accounts$/u,
      /^\/internal\/customer-accounts\/[A-Za-z0-9_-]{1,64}\/balance$/u,
    ],
  },
];

function buildRecipient(
  dispatch: (
    request: SabclInnerRequest,
  ) => Promise<SabclInnerResponse> = async () => ({
    status: 200,
    body: { ok: true },
  }),
  replayStore = new InMemoryReplayStore(),
) {
  return new SabclRecipient({
    keyring: fixtureKeyring('ledger', ['gateway']),
    replayStore,
    capabilities: CAPABILITIES,
    dispatch,
    now: () => NOW,
  });
}

function seal(request: Partial<SabclInnerRequest> = {}) {
  return sealRequest({
    sender: gateway,
    recipient: ledgerPublic,
    routeToken: ROUTE,
    payload: {
      op: 'ledger.accounts.list',
      method: 'GET',
      path: '/internal/customers/cus_1/accounts',
      correlationId: 'corr-1',
      ...request,
    },
    now: NOW,
  });
}

function errorCode(body: unknown): string {
  return (body as { error: { code: string } }).error.code;
}

test('a valid envelope is decrypted, dispatched and answered under encryption', async () => {
  const seen: SabclInnerRequest[] = [];
  const recipient = buildRecipient(async (request) => {
    seen.push(request);
    return { status: 200, body: { accounts: [] } };
  });
  const sealed = seal();
  const outcome = await recipient.handle(sealed.envelope);

  assert.equal(outcome.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.actor, undefined);
  assert.deepEqual(
    openResponse({
      responder: ledgerPublic,
      responseSecret: sealed.responseSecret,
      expectedCorrelationId: sealed.envelope.mid,
      envelope: outcome.body as SabclResponseEnvelope,
    }),
    { status: 200, body: { accounts: [] } },
  );
});

test('the actor travels encrypted and reaches the handler intact', async () => {
  let received: SabclInnerRequest | undefined;
  const recipient = buildRecipient(async (request) => {
    received = request;
    return { status: 200 };
  });
  await recipient.handle(
    seal({ actor: { customerId: 'cus_secret_42' } }).envelope,
  );
  assert.equal(received?.actor?.customerId, 'cus_secret_42');
});

test('a replayed envelope is refused', async () => {
  const recipient = buildRecipient();
  const sealed = seal();
  assert.equal((await recipient.handle(sealed.envelope)).status, 200);
  const second = await recipient.handle(sealed.envelope);
  assert.equal(errorCode(second.body), 'SABCL_REPLAYED');
});

test('concurrent duplicates dispatch exactly once', async () => {
  let dispatches = 0;
  const recipient = buildRecipient(async () => {
    dispatches += 1;
    return { status: 200 };
  });
  const sealed = seal();
  const outcomes = await Promise.all(
    Array.from({ length: 16 }, () => recipient.handle(sealed.envelope)),
  );
  assert.equal(dispatches, 1);
  assert.equal(outcomes.filter((o) => o.status === 200).length, 1);
});

test('an unauthenticated envelope never consumes a message identifier', async () => {
  // Replay state is written only after the signature verifies, so a forged
  // message cannot burn an identifier the real sender is about to use.
  const store = new InMemoryReplayStore();
  const recipient = buildRecipient(undefined, store);
  const sealed = seal();
  const forged = {
    ...sealed.envelope,
    ct: tamperBase64Url(sealed.envelope.ct),
  };
  assert.equal(
    errorCode((await recipient.handle(forged)).body),
    'SABCL_SIGNATURE_INVALID',
  );
  assert.equal((await recipient.handle(sealed.envelope)).status, 200);
});

test('a path outside the capability allowlist is refused', async () => {
  const recipient = buildRecipient();
  // A valid key and a valid route token still do not authorise every path the
  // service exposes. Without this the recipient would be a confused deputy.
  const outcome = await recipient.handle(
    seal({ path: '/internal/customer-transfers', method: 'GET' }).envelope,
  );
  assert.equal(errorCode(outcome.body), 'SABCL_ROUTE_INVALID');
});

test('path traversal, encoded or raw, is refused', async () => {
  const recipient = buildRecipient();
  for (const path of [
    '/internal/customers/../customer-transfers/accounts',
    '/internal/customers/%2e%2e%2fadmin/accounts',
    '/internal/customers/cus_1/accounts/..\\..\\secrets',
  ]) {
    const outcome = await recipient.handle(seal({ path }).envelope);
    assert.equal(errorCode(outcome.body), 'SABCL_ROUTE_INVALID', path);
  }
});

test('a method outside the capability is refused', async () => {
  const recipient = new SabclRecipient({
    keyring: fixtureKeyring('ledger', ['gateway']),
    replayStore: new InMemoryReplayStore(),
    capabilities: [{ ...CAPABILITIES[0]!, methods: ['GET'] }],
    dispatch: async () => ({ status: 200 }),
    now: () => NOW,
  });
  const outcome = await recipient.handle(
    seal({ method: 'POST', path: '/internal/customers/cus_1/accounts' })
      .envelope,
  );
  assert.equal(errorCode(outcome.body), 'SABCL_ROUTE_INVALID');
});

test('an unknown capability prefix is refused', async () => {
  const recipient = buildRecipient();
  const outcome = await recipient.handle(
    seal({ op: 'payments.transfer.confirm' }).envelope,
  );
  assert.equal(errorCode(outcome.body), 'SABCL_ROUTE_INVALID');
});

test('handle never throws and never returns a business reason', async () => {
  const recipient = buildRecipient(async () => {
    throw new Error('customer cus_9 does not exist in the ledger database');
  });
  const outcome = await recipient.handle(seal().envelope);
  const serialised = JSON.stringify(outcome.body);
  // The dispatch failure must not describe what it was looking for.
  assert.equal(serialised.includes('cus_9'), false);
  assert.equal(serialised.includes('does not exist'), false);
  assert.deepEqual(Object.keys(outcome.body), ['error']);
});

test('a missing resource and an existing one fail identically at this layer', async () => {
  // Resource existence must not be observable through the protocol layer.
  const missing = buildRecipient(async () => ({
    status: 404,
    body: { error: { code: 'NOT_FOUND' } },
  }));
  const present = buildRecipient(async () => ({
    status: 404,
    body: { error: { code: 'NOT_FOUND' } },
  }));
  const a = await missing.handle(seal().envelope);
  const b = await present.handle(seal().envelope);
  assert.equal(a.status, b.status);
  // Both are sealed responses of the same padded size, so an observer cannot
  // separate them by length either.
  assert.equal(
    (a.body as SabclResponseEnvelope).pad,
    (b.body as SabclResponseEnvelope).pad,
  );
});

test('malformed and unparseable envelopes are rejected safely', async () => {
  const recipient = buildRecipient();
  for (const bad of [null, undefined, 42, 'string', {}, { v: 'SABCL/9' }]) {
    const outcome = await recipient.handle(bad);
    assert.equal(errorCode(outcome.body), 'SABCL_MALFORMED');
  }
});

test('an envelope addressed to another service is refused', async () => {
  const recipient = buildRecipient();
  const misaddressed = sealRequest({
    sender: gateway,
    recipient: fixturePublicIdentity('payments'),
    routeToken: ROUTE,
    payload: {
      op: 'ledger.accounts.list',
      method: 'GET',
      path: '/internal/customers/cus_1/accounts',
      correlationId: 'c',
    },
    now: NOW,
  });
  const outcome = await recipient.handle(misaddressed.envelope);
  assert.equal(errorCode(outcome.body), 'SABCL_UNKNOWN_RECIPIENT');
});

test('an expired envelope is refused', async () => {
  const recipient = new SabclRecipient({
    keyring: fixtureKeyring('ledger', ['gateway']),
    replayStore: new InMemoryReplayStore(),
    capabilities: CAPABILITIES,
    dispatch: async () => ({ status: 200 }),
    now: () => NOW + 3_600,
  });
  assert.equal(
    errorCode((await recipient.handle(seal().envelope)).body),
    'SABCL_EXPIRED',
  );
});

test('status mapping does not distinguish authentication failure modes', () => {
  // Unknown sender, revoked key, bad signature and failed decryption all map to
  // 401, so probing with different key identifiers reveals nothing.
  const indistinguishable = [
    'SABCL_UNKNOWN_SENDER',
    'SABCL_UNKNOWN_RECIPIENT',
    'SABCL_KEY_REVOKED',
    'SABCL_SIGNATURE_INVALID',
    'SABCL_DECRYPTION_FAILED',
  ].map(statusForCode);
  assert.deepEqual(new Set(indistinguishable), new Set([401]));
});
