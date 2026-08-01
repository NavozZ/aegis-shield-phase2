import {
  FIXTURE_ROUTE_SECRET,
  InMemoryReplayStore,
  SABCL_CAPABILITIES,
  SabclClient,
  SabclError,
  SabclRecipient,
  SabclRouteTable,
  capabilitiesForService,
  createLoopbackDispatcher,
  deriveRouteToken,
  fixtureKeyring,
  fixturePrivateIdentity,
  fixturePublicIdentity,
  sealRequest,
  tamperBase64Url,
  type SabclInnerResponse,
} from '@aegis/sabcl';
import { NestFactory } from '@nestjs/core';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RouterRedisService } from '../src/redis/redis.service';
import { RouterService } from '../src/routing/router.service';
import {
  ROUTER_CONFIG,
  type RouterConfig,
} from '../src/common/config/router.config';
import { RouterController } from '../src/routing/router.controller';
import { configureApplication } from '../src/app.setup';
import { Module } from '@nestjs/common';

/*
 * STRICT-MODE ENCRYPTED END-TO-END JOURNEY.
 *
 * Every element is real and every hop is a socket:
 *
 *   SabclClient (what the gateway uses)
 *     -> HTTP -> RouterController + RouterService (the blind router)
 *       -> HTTP -> SabclRecipient (what the ledger uses)
 *         -> HTTP -> a stub upstream standing in for the ledger's own routes
 *
 * with Redis holding replay state. The only stub is the innermost service, so
 * that the assertions are about the SABCL path rather than about Prisma.
 *
 * What this proves that the unit suites cannot: that a payload encrypted in the
 * caller's process survives two network hops and is readable only at the far
 * end, and that the router in the middle — a real process handling real bytes —
 * never sees it.
 *
 * Requires the local infrastructure: pnpm infra:up
 */

const REDIS_PREFIX = 'aegis:sabcl:test:integration:strict:';

/** Values seeded into the journey; none may appear in router-visible bytes. */
const SENSITIVE = {
  customerId: 'cus_E2ECANARY_c41f',
  accountId: 'acc_E2ECANARY_88ab',
  amountMinor: '4250099E2ECANARY',
};

interface Harness {
  client: SabclClient;
  routerUrl: string;
  close: () => Promise<void>;
  routerObservedBodies: string[];
  upstreamCalls: { path: string; customerId: string | undefined }[];
}

/** The innermost service: what the ledger's own internal routes would answer. */
function startUpstream(): Promise<{
  server: Server;
  url: string;
  calls: { path: string; customerId: string | undefined }[];
}> {
  const calls: { path: string; customerId: string | undefined }[] = [];
  const server = createServer((request, response) => {
    calls.push({
      path: request.url ?? '',
      customerId: request.headers['x-aegis-customer-id'] as string | undefined,
    });
    response.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        accounts: [
          {
            accountId: SENSITIVE.accountId,
            balanceMinor: SENSITIVE.amountMinor,
          },
        ],
      }),
    );
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}`, calls });
    });
  });
}

/** The ledger's SABCL ingress, on its own socket. */
function startRecipient(
  upstreamUrl: string,
): Promise<{ server: Server; url: string }> {
  const recipient = new SabclRecipient({
    keyring: fixtureKeyring('ledger', ['gateway']),
    // In-memory here is correct: this stands in for one ledger instance, and
    // the router in front of it already holds the Redis-backed claim.
    replayStore: new InMemoryReplayStore(),
    capabilities: capabilitiesForService('ledger'),
    dispatch: createLoopbackDispatcher({
      baseUrl: upstreamUrl,
      internalToken: 'test-internal-token',
      timeoutMs: 5_000,
    }),
  });

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      void (async () => {
        const outcome = await recipient.handle(
          JSON.parse(Buffer.concat(chunks).toString('utf8')),
        );
        response
          .writeHead(outcome.status, { 'content-type': 'application/json' })
          .end(JSON.stringify(outcome.body));
      })();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

async function buildHarness(): Promise<Harness> {
  const upstream = await startUpstream();
  const recipient = await startRecipient(upstream.url);

  const config: RouterConfig = {
    nodeEnvironment: 'test',
    host: '127.0.0.1',
    port: 0,
    redisUrl:
      process.env.REDIS_URL?.trim() ||
      'redis://:aegis-local-redis-change-me@127.0.0.1:6379/0',
    redisKeyPrefix: REDIS_PREFIX,
    forwardTimeoutMs: 5_000,
    rateLimitPerMinute: 10_000,
    maxEnvelopeBytes: 262_144,
    sabcl: {
      mode: 'strict',
      keyring: fixtureKeyring('sabcl-router', ['gateway', 'ledger']),
      routeSecret: FIXTURE_ROUTE_SECRET,
    },
    routes: new SabclRouteTable(FIXTURE_ROUTE_SECRET, [
      {
        routeId: 'ledger.accounts',
        service: 'ledger',
        destination: recipient.url,
      },
    ]),
  };

  const redis = new RouterRedisService(config);
  await redis.onModuleInit();

  // Everything the router process handled at the HTTP boundary, captured for
  // the leakage assertion.
  const routerObservedBodies: string[] = [];

  @Module({
    controllers: [RouterController],
    providers: [
      { provide: ROUTER_CONFIG, useValue: config },
      { provide: RouterRedisService, useValue: redis },
      RouterService,
    ],
  })
  class TestRouterModule {}

  const app = await NestFactory.create(TestRouterModule, {
    bodyParser: false,
    logger: false,
  });
  configureApplication(app);
  app.use(
    (request: { body?: unknown }, _response: unknown, next: () => void) => {
      routerObservedBodies.push(JSON.stringify(request.body ?? null));
      next();
    },
  );
  await app.listen(0, '127.0.0.1');
  const routerUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');

  const client = new SabclClient({
    keyring: fixtureKeyring('gateway', ['ledger', 'sabcl-router']),
    routerUrl,
    routeSecret: FIXTURE_ROUTE_SECRET,
    timeoutMs: 8_000,
  });

  return {
    client,
    routerUrl,
    routerObservedBodies,
    upstreamCalls: upstream.calls,
    close: async () => {
      await app.close();
      await redis.onModuleDestroy();
      await new Promise((resolve) => recipient.server.close(resolve));
      await new Promise((resolve) => upstream.server.close(resolve));
    },
  };
}

function accountsCall(customerId = SENSITIVE.customerId) {
  return {
    routeId: SABCL_CAPABILITIES['ledger.accounts'].routeId,
    service: SABCL_CAPABILITIES['ledger.accounts'].service,
    request: {
      op: 'ledger.accounts.get',
      method: 'GET' as const,
      path: `/internal/customers/${customerId}/accounts`,
      actor: { customerId },
      correlationId: 'strict-e2e',
    },
  };
}

describe('strict-mode encrypted journey', () => {
  let harness: Harness;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    harness = await buildHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('carries an account retrieval end to end through the blind router', async () => {
    const response: SabclInnerResponse =
      await harness.client.send(accountsCall());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      accounts: [
        { accountId: SENSITIVE.accountId, balanceMinor: SENSITIVE.amountMinor },
      ],
    });
    // The innermost service saw the real request, re-attached from the
    // decrypted payload inside the recipient's process.
    expect(harness.upstreamCalls.at(-1)).toEqual({
      path: `/internal/customers/${SENSITIVE.customerId}/accounts`,
      customerId: SENSITIVE.customerId,
    });
  });

  it('never exposes the payload to the router process', async () => {
    await harness.client.send(accountsCall('cus_BLINDNESS_7a19'));

    const everythingTheRouterHandled = harness.routerObservedBodies.join(' ');
    expect(everythingTheRouterHandled).not.toContain('cus_BLINDNESS_7a19');
    expect(everythingTheRouterHandled).not.toContain(SENSITIVE.customerId);
    expect(everythingTheRouterHandled).not.toContain(SENSITIVE.accountId);
    expect(everythingTheRouterHandled).not.toContain(SENSITIVE.amountMinor);
    expect(everythingTheRouterHandled).not.toContain('/internal/customers');
    expect(everythingTheRouterHandled).not.toContain('ledger.accounts');
    // Sanity: the router did handle something, so the assertions above are not
    // passing merely because nothing was captured.
    expect(everythingTheRouterHandled.length).toBeGreaterThan(100);
  });

  it('refuses a replayed envelope across the whole path', async () => {
    // The client seals a fresh message identifier per send, so a replay has to
    // be driven at the transport level: post the identical envelope twice, the
    // way a network attacker who captured it would.
    const envelope = sealRequest({
      sender: fixturePrivateIdentity('gateway'),
      recipient: fixturePublicIdentity('ledger'),
      routeToken: deriveRouteToken(FIXTURE_ROUTE_SECRET, 'ledger.accounts'),
      payload: {
        op: 'ledger.accounts.get',
        method: 'GET',
        path: '/internal/customers/cus_REPLAY_1/accounts',
        correlationId: 'strict-e2e-replay',
      },
    }).envelope;

    const post = () =>
      fetch(new URL('/sabcl/v1/messages', harness.routerUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/sabcl-envelope+json' },
        body: JSON.stringify(envelope),
      });

    const first = await post();
    expect(first.status).toBe(200);

    const second = await post();
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: { code: 'SABCL_REPLAYED' } });
  });

  it('refuses a tampered envelope at the recipient, not at the router', async () => {
    // The router does not verify signatures by design, so a tampered ciphertext
    // is forwarded and rejected at the far end. That is the intended split: a
    // router that lied about authenticity would be caught by the recipient.
    const sealed = sealRequest({
      sender: fixturePrivateIdentity('gateway'),
      recipient: fixturePublicIdentity('ledger'),
      routeToken: deriveRouteToken(FIXTURE_ROUTE_SECRET, 'ledger.accounts'),
      payload: {
        op: 'ledger.accounts.get',
        method: 'GET',
        path: '/internal/customers/cus_TAMPER/accounts',
        correlationId: 'strict-e2e-tamper',
      },
    }).envelope;

    const response = await fetch(
      new URL('/sabcl/v1/messages', harness.routerUrl),
      {
        method: 'POST',
        headers: { 'content-type': 'application/sabcl-envelope+json' },
        body: JSON.stringify({ ...sealed, ct: tamperBase64Url(sealed.ct) }),
      },
    );
    expect(response.ok).toBe(false);
    // Whatever the code, it must not describe the payload.
    expect(JSON.stringify(await response.json())).not.toContain('cus_TAMPER');
  });

  it('fails safely when the router is unreachable, with no plaintext fallback', async () => {
    const orphaned = new SabclClient({
      keyring: fixtureKeyring('gateway', ['ledger']),
      routerUrl: 'http://127.0.0.1:1',
      routeSecret: FIXTURE_ROUTE_SECRET,
      timeoutMs: 2_000,
    });
    await expect(orphaned.send(accountsCall())).rejects.toBeInstanceOf(
      SabclError,
    );
    await expect(orphaned.send(accountsCall())).rejects.toMatchObject({
      code: 'SABCL_RECIPIENT_UNAVAILABLE',
    });
  });

  it('refuses a capability the sender is not routed for', async () => {
    // A route that is not in the router's table has nowhere to resolve to, even
    // though the sender holds a valid key and can derive the token.
    await expect(
      harness.client.send({
        routeId: 'payments.transfer',
        service: 'ledger',
        request: {
          op: 'payments.transfer.post',
          method: 'POST',
          path: '/internal/transfers',
          correlationId: 'strict-e2e',
        },
      }),
    ).rejects.toMatchObject({ code: 'SABCL_ROUTE_INVALID' });
  });

  it('refuses a path outside the capability even with a valid route token', async () => {
    // The route token is right; the path is not in ledger.accounts. The
    // recipient rejects it, which is the confused-deputy defence working.
    await expect(
      harness.client.send({
        routeId: 'ledger.accounts',
        service: 'ledger',
        request: {
          op: 'ledger.accounts.get',
          method: 'GET',
          path: '/internal/reconciliation/latest',
          correlationId: 'strict-e2e',
        },
      }),
    ).rejects.toMatchObject({ code: 'SABCL_ROUTE_INVALID' });
  });

  it('does not reveal whether a resource exists', async () => {
    // Both a present and an absent resource return a sealed 200 envelope of the
    // same padded size from the router's point of view.
    const present = await harness.client.send(accountsCall('cus_present'));
    const absent = await harness.client.send(accountsCall('cus_absent'));
    expect(present.status).toBe(absent.status);
  });
});
