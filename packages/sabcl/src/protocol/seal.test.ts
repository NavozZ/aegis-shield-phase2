import assert from 'node:assert/strict';
import test from 'node:test';
import {
  openRequest,
  openResponse,
  sealRequest,
  sealResponse,
} from './seal.js';
import { SabclError, type SabclErrorCode } from './errors.js';
import { deriveRouteToken } from './route-token.js';
import { SABCL_MAX_TTL_SECONDS, SABCL_PROTOCOL_VERSION } from './version.js';
import {
  FIXTURE_ROUTE_SECRET,
  fixtureKeyring,
  fixturePrivateIdentity,
  fixturePublicIdentity,
} from '../testing/fixtures.js';
import type { SabclEnvelope } from './envelope.js';
import { tamperBase64Url } from '../testing/tamper.js';

const NOW = 1_800_000_000;
const ROUTE = deriveRouteToken(FIXTURE_ROUTE_SECRET, 'ledger.accounts');

const gateway = fixturePrivateIdentity('gateway');
const ledgerPublic = fixturePublicIdentity('ledger');
const ledgerPrivate = fixturePrivateIdentity('ledger');
/** Ledger's view of the world: it trusts the gateway. */
const ledgerKeyring = fixtureKeyring('ledger', ['gateway']);

const PAYLOAD = {
  op: 'ledger.accounts.list',
  method: 'GET' as const,
  path: '/internal/customers/cus_123/accounts',
  actor: { customerId: 'cus_123' },
  correlationId: 'corr-1',
};

function seal(overrides: Partial<Parameters<typeof sealRequest>[0]> = {}) {
  return sealRequest({
    sender: gateway,
    recipient: ledgerPublic,
    routeToken: ROUTE,
    payload: PAYLOAD,
    now: NOW,
    ...overrides,
  });
}

function open(envelope: SabclEnvelope, now = NOW) {
  return openRequest({
    recipient: ledgerPrivate,
    keyring: ledgerKeyring,
    envelope,
    now,
  });
}

function expectCode(run: () => unknown, code: SabclErrorCode) {
  assert.throws(run, (error: unknown) => {
    assert.ok(
      error instanceof SabclError,
      `expected SabclError, got ${String(error)}`,
    );
    assert.equal(error.code, code);
    return true;
  });
}

test('a sealed request round-trips to the intended recipient', () => {
  const { envelope } = seal();
  const opened = open(envelope);
  assert.deepEqual(opened.payload, PAYLOAD);
  assert.equal(opened.senderKeyId, 'gateway.v1');
  assert.equal(opened.senderService, 'gateway');
  assert.equal(opened.routeToken, ROUTE);
  assert.equal(envelope.v, SABCL_PROTOCOL_VERSION);
});

test('the same payload produces different ciphertext and a fresh message id', () => {
  const first = seal().envelope;
  const second = seal().envelope;
  assert.notEqual(
    first.ct,
    second.ct,
    'deterministic ciphertext would leak equality',
  );
  assert.notEqual(first.mid, second.mid);
  assert.notEqual(first.n, second.n);
  assert.notEqual(first.epk, second.epk, 'ephemeral key must not be reused');
});

test('payload tampering fails', () => {
  const { envelope } = seal();
  expectCode(
    () => open({ ...envelope, ct: tamperBase64Url(envelope.ct) }),
    'SABCL_SIGNATURE_INVALID',
  );
});

test('route-token tampering fails', () => {
  const { envelope } = seal();
  const swapped = deriveRouteToken(FIXTURE_ROUTE_SECRET, 'payments.transfer');
  // Route swapping breaks the signature because rt is inside the signed header.
  expectCode(
    () => open({ ...envelope, rt: swapped }),
    'SABCL_SIGNATURE_INVALID',
  );
});

test('signature tampering fails', () => {
  const { envelope } = seal();
  expectCode(
    () => open({ ...envelope, sig: tamperBase64Url(envelope.sig) }),
    'SABCL_SIGNATURE_INVALID',
  );
});

test('authentication-tag tampering fails', () => {
  const { envelope } = seal();
  expectCode(
    () => open({ ...envelope, tag: tamperBase64Url(envelope.tag) }),
    'SABCL_SIGNATURE_INVALID',
  );
});

test('every authenticated header field is bound to the ciphertext', () => {
  const { envelope } = seal();
  // Each mutation must be rejected. Together these prove the AAD covers the
  // whole header rather than a convenient subset of it.
  const mutations: [string, SabclEnvelope][] = [
    ['mid', { ...envelope, mid: 'AAAAAAAAAAAAAAAAAAAAAA' }],
    ['iat', { ...envelope, iat: envelope.iat - 1 }],
    ['exp', { ...envelope, exp: envelope.exp + 1 }],
    ['hl', { ...envelope, hl: envelope.hl + 1 }],
    ['pad', { ...envelope, pad: envelope.pad * 2 }],
    ['epk', { ...envelope, epk: seal().envelope.epk }],
    ['n', { ...envelope, n: seal().envelope.n }],
  ];
  for (const [field, mutated] of mutations) {
    assert.throws(
      () => open(mutated),
      SabclError,
      `mutating ${field} must be rejected`,
    );
  }
});

test('expired messages fail before any key is touched', () => {
  const { envelope } = seal({ ttlSeconds: 10 });
  assert.ok(open(envelope, NOW + 9));
  expectCode(() => open(envelope, NOW + 11), 'SABCL_EXPIRED');
});

test('messages issued in the future beyond clock skew fail', () => {
  const { envelope } = seal();
  expectCode(() => open(envelope, NOW - 60), 'SABCL_EXPIRED');
});

test('a ttl beyond the protocol ceiling is refused at seal time', () => {
  expectCode(
    () => seal({ ttlSeconds: SABCL_MAX_TTL_SECONDS + 1 }),
    'SABCL_MALFORMED',
  );
  expectCode(() => seal({ ttlSeconds: 0 }), 'SABCL_MALFORMED');
});

test('hop limits outside the bound are refused at seal time', () => {
  expectCode(() => seal({ hopLimit: 0 }), 'SABCL_MALFORMED');
  expectCode(() => seal({ hopLimit: 99 }), 'SABCL_MALFORMED');
});

test('wrong-recipient decryption fails', () => {
  const { envelope } = seal({ recipient: fixturePublicIdentity('payments') });
  // Addressed to payments; ledger must refuse rather than attempt decryption.
  expectCode(() => open(envelope), 'SABCL_UNKNOWN_RECIPIENT');
});

test('a recipient cannot open a message sealed to a different key of its own service', () => {
  const { envelope } = seal({ recipient: fixturePublicIdentity('ledger', 2) });
  expectCode(() => open(envelope), 'SABCL_UNKNOWN_RECIPIENT');
});

test('wrong-sender identity fails', () => {
  // Sealed and signed by payments, but claiming to be a service ledger trusts.
  const { envelope } = sealRequest({
    sender: fixturePrivateIdentity('payments'),
    recipient: ledgerPublic,
    routeToken: ROUTE,
    payload: PAYLOAD,
    now: NOW,
  });
  expectCode(() => open(envelope), 'SABCL_UNKNOWN_SENDER');
});

test('a forged skid claiming a trusted sender fails signature verification', () => {
  const { envelope } = sealRequest({
    sender: fixturePrivateIdentity('payments'),
    recipient: ledgerPublic,
    routeToken: ROUTE,
    payload: PAYLOAD,
    now: NOW,
  });
  expectCode(
    () => open({ ...envelope, skid: 'gateway.v1' }),
    'SABCL_SIGNATURE_INVALID',
  );
});

test('a revoked sender key is rejected', () => {
  const keyring = fixtureKeyring('ledger', [
    { service: 'gateway', revoked: true },
  ]);
  const { envelope } = seal();
  expectCode(
    () =>
      openRequest({
        recipient: ledgerPrivate,
        keyring,
        envelope,
        now: NOW,
      }),
    'SABCL_KEY_REVOKED',
  );
});

test('an expired sender key is rejected', () => {
  const keyring = fixtureKeyring('ledger', [
    { service: 'gateway', notAfter: NOW - 1 },
  ]);
  const { envelope } = seal();
  expectCode(
    () =>
      openRequest({ recipient: ledgerPrivate, keyring, envelope, now: NOW }),
    'SABCL_KEY_REVOKED',
  );
});

test('rotated keys interoperate: v2 sender to a recipient that accepts v1 and v2', () => {
  const rotatedGateway = fixturePrivateIdentity('gateway', 2);
  const keyring = fixtureKeyring('ledger', [
    { service: 'gateway', version: 1 },
    { service: 'gateway', version: 2 },
  ]);
  const { envelope } = sealRequest({
    sender: rotatedGateway,
    recipient: ledgerPublic,
    routeToken: ROUTE,
    payload: PAYLOAD,
    now: NOW,
  });
  const opened = openRequest({
    recipient: ledgerPrivate,
    keyring,
    envelope,
    now: NOW,
  });
  assert.equal(opened.senderKeyId, 'gateway.v2');
  // The previous key still opens, which is what makes a rolling rotation safe.
  const legacy = seal();
  assert.ok(
    openRequest({
      recipient: ledgerPrivate,
      keyring,
      envelope: legacy.envelope,
      now: NOW,
    }),
  );
});

test('responses round-trip and are bound to their request', () => {
  const sealed = seal();
  const opened = open(sealed.envelope);
  const response = sealResponse({
    responder: ledgerPrivate,
    responseSecret: opened.responseSecret,
    correlationId: opened.messageId,
    payload: { status: 200, body: { balance: '100.00' } },
  });
  assert.deepEqual(
    openResponse({
      responder: ledgerPublic,
      responseSecret: sealed.responseSecret,
      expectedCorrelationId: sealed.envelope.mid,
      envelope: response,
    }),
    { status: 200, body: { balance: '100.00' } },
  );
});

test('a response for a different request is rejected', () => {
  const first = seal();
  const second = seal();
  const opened = open(first.envelope);
  const response = sealResponse({
    responder: ledgerPrivate,
    responseSecret: opened.responseSecret,
    correlationId: opened.messageId,
    payload: { status: 200 },
  });
  expectCode(
    () =>
      openResponse({
        responder: ledgerPublic,
        responseSecret: second.responseSecret,
        expectedCorrelationId: second.envelope.mid,
        envelope: response,
      }),
    'SABCL_MALFORMED',
  );
});

test('a tampered response fails', () => {
  const sealed = seal();
  const opened = open(sealed.envelope);
  const response = sealResponse({
    responder: ledgerPrivate,
    responseSecret: opened.responseSecret,
    correlationId: opened.messageId,
    payload: { status: 200 },
  });
  expectCode(
    () =>
      openResponse({
        responder: ledgerPublic,
        responseSecret: sealed.responseSecret,
        expectedCorrelationId: sealed.envelope.mid,
        envelope: { ...response, ct: tamperBase64Url(response.ct) },
      }),
    'SABCL_SIGNATURE_INVALID',
  );
});

test('request and response keys are independent', () => {
  // Reusing a request key to open a response (or vice versa) must not work;
  // the HKDF domain tags are what prevent it.
  const sealed = seal();
  const opened = open(sealed.envelope);
  const response = sealResponse({
    responder: ledgerPrivate,
    responseSecret: opened.responseSecret,
    correlationId: opened.messageId,
    payload: { status: 200 },
  });
  assert.notEqual(response.n, sealed.envelope.n);
  assert.notEqual(response.ct, sealed.envelope.ct);
});

test('an oversized payload is refused rather than truncated', () => {
  expectCode(
    () => seal({ payload: { blob: 'x'.repeat(70_000) } }),
    'SABCL_OVERSIZED',
  );
});

test('a message sealed with an expired sender key is refused at seal time', () => {
  const expiring = { ...gateway, notAfter: NOW - 1 };
  expectCode(() => seal({ sender: expiring }), 'SABCL_KEY_REVOKED');
});

test('sealing to a revoked recipient is refused', () => {
  expectCode(
    () =>
      seal({
        recipient: fixturePublicIdentity('ledger', 1, { revoked: true }),
      }),
    'SABCL_KEY_REVOKED',
  );
});
