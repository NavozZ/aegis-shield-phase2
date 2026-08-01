import {
  FIXTURE_ROUTE_SECRET,
  InMemoryReplayStore,
  SabclRouteTable,
  deriveRouteToken,
  fixtureKeyring,
  fixturePrivateIdentity,
  fixturePublicIdentity,
  openRequest,
  sealRequest,
  sealResponse,
  type SabclEnvelope,
  type SabclResponseEnvelope,
} from '@aegis/sabcl';
import { Logger } from '@nestjs/common';
import { RouterService } from './router.service';
import type { RouterConfig } from '../common/config/router.config';
import type { RouterRedisService } from '../redis/redis.service';

/*
 * The router under test is given fixture keys and an in-memory replay store, so
 * these are true unit tests. The Redis-backed replay path has its own
 * integration suite in test/router.integration-spec.ts.
 */

const ROUTES = [
  {
    routeId: 'ledger.accounts',
    service: 'ledger',
    destination: 'http://ledger.test',
  },
  {
    routeId: 'payments.transfer',
    service: 'payments',
    destination: 'http://payments.test',
  },
  {
    routeId: 'identity.step-up',
    service: 'identity',
    destination: 'http://identity.test',
    revoked: true,
  },
];

const gateway = fixturePrivateIdentity('gateway');
const ledgerPublic = fixturePublicIdentity('ledger');
const ledgerPrivate = fixturePrivateIdentity('ledger');

/** A fake Redis that is atomic in the same way the real one is. */
function fakeRedis(): RouterRedisService & { rateCalls: string[] } {
  const replay = new InMemoryReplayStore();
  const rates = new Map<string, number>();
  const rateCalls: string[] = [];
  return {
    rateCalls,
    remember: (messageId: string, ttl: number) =>
      replay.remember(messageId, ttl),
    incrementRate: (senderKeyId: string) => {
      rateCalls.push(senderKeyId);
      const next = (rates.get(senderKeyId) ?? 0) + 1;
      rates.set(senderKeyId, next);
      return Promise.resolve(next);
    },
    ping: () => Promise.resolve(true),
  } as unknown as RouterRedisService & { rateCalls: string[] };
}

function buildConfig(overrides: Partial<RouterConfig> = {}): RouterConfig {
  return {
    nodeEnvironment: 'test',
    host: '127.0.0.1',
    port: 4103,
    redisUrl: 'redis://127.0.0.1:6379',
    redisKeyPrefix: 'aegis:sabcl:test:unit:',
    forwardTimeoutMs: 1_000,
    rateLimitPerMinute: 600,
    maxEnvelopeBytes: 262_144,
    sabcl: {
      mode: 'strict',
      keyring: fixtureKeyring('sabcl-router', [
        'gateway',
        'ledger',
        'payments',
      ]),
      routeSecret: FIXTURE_ROUTE_SECRET,
    },
    routes: new SabclRouteTable(FIXTURE_ROUTE_SECRET, ROUTES),
    ...overrides,
  };
}

/** A freshly sealed, valid gateway-to-ledger request. */
function sealed() {
  return sealRequest({
    sender: gateway,
    recipient: ledgerPublic,
    routeToken: deriveRouteToken(FIXTURE_ROUTE_SECRET, 'ledger.accounts'),
    payload: {
      op: 'ledger.accounts.list',
      method: 'GET',
      path: '/internal/customers/cus_1/accounts',
      correlationId: 'c',
    },
  });
}

/** Records what the router forwarded and answers with a valid sealed reply. */
function recordingFetch(options: { status?: number; body?: unknown } = {}) {
  const calls: {
    url: string;
    envelope: SabclEnvelope;
    headers: HeadersInit | undefined;
  }[] = [];
  const implementation = jest.fn(
    (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      // The router always forwards a JSON string body; anything else is a bug
      // in the router rather than a case this stub should tolerate.
      const rawBody = typeof init?.body === 'string' ? init.body : '';
      const envelope = JSON.parse(rawBody) as SabclEnvelope;
      calls.push({
        url:
          input instanceof URL
            ? input.href
            : typeof input === 'string'
              ? input
              : input.url,
        envelope,
        headers: init?.headers,
      });
      if (options.status && options.status !== 200) {
        return Promise.resolve(
          new Response(JSON.stringify(options.body ?? {}), {
            status: options.status,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      const opened = openRequest({
        recipient: ledgerPrivate,
        keyring: fixtureKeyring('ledger', ['gateway']),
        envelope,
      });
      const response = sealResponse({
        responder: ledgerPrivate,
        responseSecret: opened.responseSecret,
        correlationId: opened.messageId,
        payload: { status: 200, body: { accounts: [] } },
      });
      return Promise.resolve(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  );
  return { calls, implementation };
}

function errorCode(body: unknown): string {
  return (body as { error: { code: string } }).error.code;
}

describe('RouterService', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('forwards a valid envelope to its allowlisted destination', async () => {
    const { calls, implementation } = recordingFetch();
    global.fetch = implementation as unknown as typeof fetch;
    const service = new RouterService(buildConfig(), fakeRedis());

    const message = sealed();
    const outcome = await service.route(message.envelope, 2_000);

    expect(outcome.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://ledger.test/sabcl/v1/inbound');
  });

  it('forwards the envelope byte-for-byte without adding metadata', async () => {
    const { calls, implementation } = recordingFetch();
    global.fetch = implementation as unknown as typeof fetch;
    const service = new RouterService(buildConfig(), fakeRedis());

    const message = sealed();
    await service.route(message.envelope, 2_000);

    // The router must not enrich the message. Anything it added would be
    // metadata it invented about traffic it cannot read.
    expect(calls[0]?.envelope).toEqual(message.envelope);
    expect(Object.keys(calls[0]?.headers ?? {})).toEqual(['content-type']);
  });

  it('cannot read the payload it forwards', async () => {
    const { calls, implementation } = recordingFetch();
    global.fetch = implementation as unknown as typeof fetch;
    const service = new RouterService(buildConfig(), fakeRedis());

    const secret = 'cus_ROUTERBLINDNESS_9f21';
    const message = sealRequest({
      sender: gateway,
      recipient: ledgerPublic,
      routeToken: deriveRouteToken(FIXTURE_ROUTE_SECRET, 'ledger.accounts'),
      payload: {
        op: 'ledger.accounts.list',
        method: 'GET',
        path: `/internal/customers/${secret}/accounts`,
        actor: { customerId: secret },
        correlationId: 'c',
      },
    });
    await service.route(message.envelope, 2_000);

    // Everything the router touched, serialised: the envelope it received, what
    // it forwarded, and its own counters. None of it may contain the payload.
    const everythingTheRouterSaw = JSON.stringify([
      message.envelope,
      calls[0]?.envelope,
      service.counterSnapshot(),
    ]);
    expect(everythingTheRouterSaw).not.toContain(secret);
    expect(everythingTheRouterSaw).not.toContain('/internal/customers');
  });

  it('rejects an unknown route token with nowhere to resolve to', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const service = new RouterService(buildConfig(), fakeRedis());
    const message = sealRequest({
      sender: gateway,
      recipient: ledgerPublic,
      routeToken: Buffer.alloc(32, 9).toString('base64url'),
      payload: { op: 'a.b', method: 'GET', path: '/x', correlationId: 'c' },
    });
    const outcome = await service.route(message.envelope, 2_000);
    expect(errorCode(outcome.body)).toBe('SABCL_ROUTE_INVALID');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a revoked route', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const service = new RouterService(buildConfig(), fakeRedis());
    const message = sealRequest({
      sender: gateway,
      recipient: fixturePublicIdentity('identity'),
      routeToken: deriveRouteToken(FIXTURE_ROUTE_SECRET, 'identity.step-up'),
      payload: {
        op: 'identity.step-up.verify',
        method: 'POST',
        path: '/x',
        correlationId: 'c',
      },
    });
    const outcome = await service.route(message.envelope, 2_000);
    expect(errorCode(outcome.body)).toBe('SABCL_ROUTE_INVALID');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('is not a generic proxy: no request shape names a destination', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const service = new RouterService(buildConfig(), fakeRedis());
    // An attacker who controls the whole envelope still cannot express a URL.
    // The nearest thing to a destination is `rt`, and that is a lookup key.
    for (const attempt of [
      'http://attacker.test',
      '../../admin',
      'file:///etc/passwd',
    ]) {
      const outcome = await service.route(
        {
          ...sealed().envelope,
          rt: Buffer.from(attempt).toString('base64url'),
        },
        2_000,
      );
      expect(errorCode(outcome.body)).toBe('SABCL_ROUTE_INVALID');
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses a replayed envelope before spending an upstream request', async () => {
    const { implementation } = recordingFetch();
    global.fetch = implementation as unknown as typeof fetch;
    const service = new RouterService(buildConfig(), fakeRedis());

    const message = sealed();
    expect((await service.route(message.envelope, 2_000)).status).toBe(200);
    const second = await service.route(message.envelope, 2_000);
    expect(errorCode(second.body)).toBe('SABCL_REPLAYED');
    expect(implementation).toHaveBeenCalledTimes(1);
  });

  it('admits exactly one of a set of concurrent duplicates', async () => {
    const { implementation } = recordingFetch();
    global.fetch = implementation as unknown as typeof fetch;
    const service = new RouterService(buildConfig(), fakeRedis());

    const message = sealed();
    const outcomes = await Promise.all(
      Array.from({ length: 12 }, () => service.route(message.envelope, 2_000)),
    );
    expect(outcomes.filter((o) => o.status === 200)).toHaveLength(1);
    expect(implementation).toHaveBeenCalledTimes(1);
  });

  it('refuses an expired envelope', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const service = new RouterService(buildConfig(), fakeRedis());
    const message = sealRequest({
      sender: gateway,
      recipient: ledgerPublic,
      routeToken: deriveRouteToken(FIXTURE_ROUTE_SECRET, 'ledger.accounts'),
      payload: {
        op: 'ledger.accounts.list',
        method: 'GET',
        path: '/x',
        correlationId: 'c',
      },
      ttlSeconds: 1,
      now: Math.floor(Date.now() / 1_000) - 3_600,
    });
    const outcome = await service.route(message.envelope, 2_000);
    expect(errorCode(outcome.body)).toBe('SABCL_EXPIRED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses an envelope from an unknown sender key', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const service = new RouterService(
      buildConfig({
        sabcl: {
          mode: 'strict',
          keyring: fixtureKeyring('sabcl-router', ['ledger']),
          routeSecret: FIXTURE_ROUTE_SECRET,
        },
      }),
      fakeRedis(),
    );
    const outcome = await service.route(sealed().envelope, 2_000);
    expect(errorCode(outcome.body)).toBe('SABCL_UNKNOWN_SENDER');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses an envelope whose hop budget is exhausted', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const service = new RouterService(buildConfig(), fakeRedis());
    const outcome = await service.route({ ...sealed().envelope, hl: 0 }, 2_000);
    expect(errorCode(outcome.body)).toBe('SABCL_HOP_LIMIT_EXCEEDED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses an oversized envelope before parsing it', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const service = new RouterService(
      buildConfig({ maxEnvelopeBytes: 1_024 }),
      fakeRedis(),
    );
    const outcome = await service.route(sealed().envelope, 999_999);
    expect(errorCode(outcome.body)).toBe('SABCL_OVERSIZED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('enforces a per-sender rate limit', async () => {
    const { implementation } = recordingFetch();
    global.fetch = implementation as unknown as typeof fetch;
    const service = new RouterService(
      buildConfig({ rateLimitPerMinute: 2 }),
      fakeRedis(),
    );

    const outcomes = [];
    for (let index = 0; index < 4; index += 1) {
      outcomes.push(await service.route(sealed().envelope, 2_000));
    }
    expect(outcomes.filter((o) => o.status === 200)).toHaveLength(2);
    expect(errorCode(outcomes[3]!.body)).toBe('SABCL_ROUTE_INVALID');
  });

  it('reports an unreachable recipient without pretending it succeeded', async () => {
    global.fetch = jest.fn(() =>
      Promise.reject(new Error('ECONNREFUSED')),
    ) as unknown as typeof fetch;
    const service = new RouterService(buildConfig(), fakeRedis());
    const outcome = await service.route(sealed().envelope, 2_000);
    expect(outcome.status).toBe(503);
    expect(errorCode(outcome.body)).toBe('SABCL_RECIPIENT_UNAVAILABLE');
  });

  it('does not relay a business error a recipient leaked', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: 'ACCOUNT_NOT_FOUND',
              message: 'customer cus_9 has no account',
            },
          }),
          { status: 404, headers: { 'content-type': 'application/json' } },
        ),
      ),
    ) as unknown as typeof fetch;
    const service = new RouterService(buildConfig(), fakeRedis());
    const outcome = await service.route(sealed().envelope, 2_000);
    const serialised = JSON.stringify(outcome.body);
    expect(serialised).not.toContain('cus_9');
    expect(serialised).not.toContain('ACCOUNT_NOT_FOUND');
    expect(errorCode(outcome.body)).toBe('SABCL_RECIPIENT_UNAVAILABLE');
  });

  it('refuses a response that is not a valid sealed envelope', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ accounts: ['plaintext'] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ) as unknown as typeof fetch;
    const service = new RouterService(buildConfig(), fakeRedis());
    const outcome = await service.route(sealed().envelope, 2_000);
    expect(errorCode(outcome.body)).toBe('SABCL_RECIPIENT_UNAVAILABLE');
  });

  it('returns the recipient response envelope unchanged', async () => {
    const { implementation } = recordingFetch();
    global.fetch = implementation as unknown as typeof fetch;
    const service = new RouterService(buildConfig(), fakeRedis());

    const message = sealed();
    const outcome = await service.route(message.envelope, 2_000);
    const body = outcome.body as SabclResponseEnvelope;
    expect(body.cid).toBe(message.envelope.mid);
    expect(typeof body.ct).toBe('string');
  });

  it('rejects malformed input without throwing', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const service = new RouterService(buildConfig(), fakeRedis());
    for (const bad of [
      null,
      42,
      'x',
      {},
      { v: 'SABCL/2' },
      { ...sealed().envelope, extra: 1 },
    ]) {
      const outcome = await service.route(bad, 100);
      expect(['SABCL_MALFORMED', 'SABCL_UNSUPPORTED_VERSION']).toContain(
        errorCode(outcome.body),
      );
    }
  });

  it('counts outcomes for the operator surface without recording payloads', async () => {
    const { implementation } = recordingFetch();
    global.fetch = implementation as unknown as typeof fetch;
    const service = new RouterService(buildConfig(), fakeRedis());

    const message = sealed();
    await service.route(message.envelope, 2_000);
    await service.route(message.envelope, 2_000);
    await service.route({ nonsense: true }, 100);

    const counters = service.counterSnapshot();
    expect(counters['envelope.accepted']).toBe(1);
    expect(counters['envelope.replayed']).toBe(1);
    expect(counters['envelope.rejected']).toBe(1);
  });

  it('logs privacy-safe records: digests, never wire values', async () => {
    const { implementation } = recordingFetch();
    global.fetch = implementation as unknown as typeof fetch;
    const logged: string[] = [];
    jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((message: unknown) => {
        logged.push(String(message));
      });
    const service = new RouterService(buildConfig(), fakeRedis());

    const message = sealed();
    await service.route(message.envelope, 2_000);
    await service.route(message.envelope, 2_000);

    const combined = logged.join(' ');
    expect(combined).toContain('envelope.accepted');
    expect(combined).toContain('envelope.replayed');
    // The message identifier and route token are recorded as salted digests,
    // so two log lines about one message correlate without the log being a
    // lookup table back to the wire.
    expect(combined).not.toContain(message.envelope.mid);
    expect(combined).not.toContain(message.envelope.rt);
    expect(combined).not.toContain(message.envelope.ct);
    expect(combined).not.toContain(message.envelope.sig);
  });

  it('does not log the router private key or the route secret', async () => {
    const { implementation } = recordingFetch();
    global.fetch = implementation as unknown as typeof fetch;
    const logged: string[] = [];
    jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((message: unknown) => {
        logged.push(String(message));
      });
    const service = new RouterService(buildConfig(), fakeRedis());
    await service.route(sealed().envelope, 2_000);

    expect(logged.join(' ')).not.toContain(
      FIXTURE_ROUTE_SECRET.toString('base64url'),
    );
  });
});
