import {
  FIXTURE_ROUTE_SECRET,
  SabclRouteTable,
  deriveRouteToken,
  fixtureKeyring,
  fixturePrivateIdentity,
  fixturePublicIdentity,
  openRequest,
  sealRequest,
  sealResponse,
  type SabclEnvelope,
} from '@aegis/sabcl';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { RouterRedisService } from '../src/redis/redis.service';
import { RouterService } from '../src/routing/router.service';
import type { RouterConfig } from '../src/common/config/router.config';

/*
 * Router plus real Redis plus a real recipient socket.
 *
 * The unit suite proves the routing decisions; this one proves the two things
 * only a real deployment can show: that replay state is genuinely shared and
 * atomic across router instances, and that the encrypted path works over a
 * socket rather than a mocked fetch.
 *
 * Requires the local infrastructure: pnpm infra:up
 */

const REDIS_PREFIX = 'aegis:sabcl:test:integration:';

const gateway = fixturePrivateIdentity('gateway');
const ledgerPublic = fixturePublicIdentity('ledger');
const ledgerPrivate = fixturePrivateIdentity('ledger');

/** A minimal recipient that decrypts, echoes and re-seals. */
function startRecipient(): Promise<{
  server: Server;
  url: string;
  seen: string[];
}> {
  const seen: string[] = [];
  const server = createServer((request, response) => {
    if (request.url !== '/sabcl/v1/inbound') {
      response.writeHead(404).end('{}');
      return;
    }
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      try {
        const envelope = JSON.parse(
          Buffer.concat(chunks).toString('utf8'),
        ) as SabclEnvelope;
        const opened = openRequest<{ path: string }>({
          recipient: ledgerPrivate,
          keyring: fixtureKeyring('ledger', ['gateway']),
          envelope,
        });
        seen.push(opened.payload.path);
        const sealedResponse = sealResponse({
          responder: ledgerPrivate,
          responseSecret: opened.responseSecret,
          correlationId: opened.messageId,
          payload: { status: 200, body: { echoed: opened.payload.path } },
        });
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify(sealedResponse));
      } catch {
        response
          .writeHead(401, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: { code: 'SABCL_DECRYPTION_FAILED' } }));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}`, seen });
    });
  });
}

function buildConfig(destination: string): RouterConfig {
  return {
    nodeEnvironment: 'test',
    host: '127.0.0.1',
    port: 4103,
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
      { routeId: 'ledger.accounts', service: 'ledger', destination },
    ]),
  };
}

function seal(path = '/internal/customers/cus_1/accounts') {
  return sealRequest({
    sender: gateway,
    recipient: ledgerPublic,
    routeToken: deriveRouteToken(FIXTURE_ROUTE_SECRET, 'ledger.accounts'),
    payload: {
      op: 'ledger.accounts.list',
      method: 'GET',
      path,
      correlationId: 'integration',
    },
  });
}

describe('SABCL router with Redis replay state', () => {
  let recipient: Awaited<ReturnType<typeof startRecipient>>;
  let redis: RouterRedisService;
  let config: RouterConfig;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    recipient = await startRecipient();
    config = buildConfig(recipient.url);
    redis = new RouterRedisService(config);
    await redis.onModuleInit();
    await redis.cleanupIsolatedTestPrefix();
  });

  afterAll(async () => {
    await redis.cleanupIsolatedTestPrefix();
    await redis.onModuleDestroy();
    await new Promise((resolve) => recipient.server.close(resolve));
  });

  it('routes an encrypted request over a real socket and returns a sealed response', async () => {
    const service = new RouterService(config, redis);
    const message = seal('/internal/customers/cus_socket/accounts');
    const outcome = await service.route(message.envelope, 2_000);

    expect(outcome.status).toBe(200);
    // The recipient decrypted it, which is only possible if the ciphertext
    // survived the round trip intact.
    expect(recipient.seen).toContain('/internal/customers/cus_socket/accounts');
  });

  it('shares replay state across router instances', async () => {
    // Two RouterService instances model two router processes behind a load
    // balancer. An in-process replay cache would let the second accept the
    // duplicate; Redis is what makes the guarantee deployment-wide.
    const first = new RouterService(config, redis);
    const second = new RouterService(config, redis);
    const message = seal();

    expect((await first.route(message.envelope, 2_000)).status).toBe(200);
    const replayed = await second.route(message.envelope, 2_000);
    expect((replayed.body as { error: { code: string } }).error.code).toBe(
      'SABCL_REPLAYED',
    );
  });

  it('admits exactly one concurrent duplicate across instances', async () => {
    const instances = Array.from(
      { length: 4 },
      () => new RouterService(config, redis),
    );
    const message = seal('/internal/customers/cus_race/accounts');
    const outcomes = await Promise.all(
      instances.flatMap((service) => [
        service.route(message.envelope, 2_000),
        service.route(message.envelope, 2_000),
      ]),
    );
    expect(outcomes.filter((outcome) => outcome.status === 200)).toHaveLength(
      1,
    );
  });

  it('namespaces its keys so it cannot collide with other services', async () => {
    const message = seal('/internal/customers/cus_ns/accounts');
    await new RouterService(config, redis).route(message.envelope, 2_000);
    // The key must live under the SABCL prefix, not a bare message id.
    expect(redis.key('replay', message.envelope.mid)).toBe(
      `${REDIS_PREFIX}replay:${message.envelope.mid}`,
    );
  });

  it('expires replay state so retention stays bounded by the message TTL', async () => {
    const shortLived = sealRequest({
      sender: gateway,
      recipient: ledgerPublic,
      routeToken: deriveRouteToken(FIXTURE_ROUTE_SECRET, 'ledger.accounts'),
      payload: {
        op: 'ledger.accounts.list',
        method: 'GET',
        path: '/internal/customers/cus_ttl/accounts',
        correlationId: 'ttl',
      },
      ttlSeconds: 1,
    });
    const service = new RouterService(config, redis);
    expect((await service.route(shortLived.envelope, 2_000)).status).toBe(200);
    // Once the window passes the identifier is released — but the envelope that
    // used it is expired by then, so this does not reopen a replay window.
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    const afterExpiry = await service.route(shortLived.envelope, 2_000);
    expect((afterExpiry.body as { error: { code: string } }).error.code).toBe(
      'SABCL_EXPIRED',
    );
  });

  it('reports a recipient outage without falling back to anything', async () => {
    const brokenConfig = buildConfig('http://127.0.0.1:1');
    const service = new RouterService(brokenConfig, redis);
    const outcome = await service.route(
      seal('/internal/customers/cus_down/accounts').envelope,
      2_000,
    );
    expect(outcome.status).toBe(503);
    expect((outcome.body as { error: { code: string } }).error.code).toBe(
      'SABCL_RECIPIENT_UNAVAILABLE',
    );
  });

  it('refuses to clean a prefix that is not an isolated test prefix', async () => {
    const production = new RouterRedisService({
      ...config,
      redisKeyPrefix: 'aegis:sabcl:',
    });
    await expect(production.cleanupIsolatedTestPrefix()).rejects.toThrow(
      /isolated test prefix/u,
    );
  });
});
