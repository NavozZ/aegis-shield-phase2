import { HttpException } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RequestContext } from '../common/http/request-context';
import type { GatewayConfig } from '../config/gateway.config';
import { ResilienceClient } from './resilience.client';

/*
 * What the gateway does when the Resilience service misbehaves.
 *
 * The console is the only browser-visible surface over recovery evidence, so
 * this boundary has two jobs when things go wrong: stay bounded, and stay
 * quiet. A stalled upstream must not hold a request open, and an upstream that
 * starts returning fields it should not must not have them forwarded to a
 * browser just because the status code was 200.
 */

const servers: Server[] = [];
const requests: { path: string; headers: Record<string, unknown> }[] = [];

async function serve(
  respond: (path: string) => { status: number; body: unknown } | 'stall',
): Promise<string> {
  const pending: NodeJS.Timeout[] = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url ?? '', headers: request.headers });
    const result = respond(request.url ?? '');
    if (result === 'stall') {
      pending.push(setTimeout(() => response.end('{}'), 30_000));
      return;
    }
    response.statusCode = result.status;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(result.body));
  });
  server.on('close', () => {
    for (const timer of pending) clearTimeout(timer);
  });
  servers.push(server);
  await new Promise<void>((settle) => server.listen(0, '127.0.0.1', settle));
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

afterAll(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((settle) => {
          server.closeAllConnections();
          server.close(() => settle());
        }),
    ),
  );
});

const request = {
  correlationId: 'correlation-1111-2222',
} as unknown as RequestContext;

function client(url: string, timeoutMs = 2_000) {
  return new ResilienceClient({
    resilienceServiceUrl: url,
    resilienceGatewaySourceToken: 'unit-only-gateway-source-token',
    resilienceTimeoutMs: timeoutMs,
  } as GatewayConfig);
}

const READINESS = {
  platformState: 'HEALTHY',
  services: [],
  dependencies: [],
  latestBackup: null,
  latestDrill: null,
  generatedAt: new Date().toISOString(),
};

describe('ResilienceClient failure policy', () => {
  it('sends its own source token and the correlation id, never an internal token', async () => {
    const url = await serve(() => ({ status: 200, body: READINESS }));
    requests.length = 0;
    await client(url).readiness(request);
    const [sent] = requests;
    expect(sent?.headers['x-aegis-source-token']).toBe(
      'unit-only-gateway-source-token',
    );
    expect(sent?.headers['x-correlation-id']).toBe('correlation-1111-2222');
    expect(sent?.headers['x-aegis-internal-token']).toBeUndefined();
  });

  it('collapses an upstream 500 to an unavailable state with no upstream detail', async () => {
    const url = await serve(() => ({
      status: 500,
      body: {
        message: 'connect ECONNREFUSED 10.0.0.7:5432 for aegis_resilience',
        stack: 'at PrismaService.connect',
      },
    }));
    await expect(client(url).readiness(request)).rejects.toMatchObject({
      status: 503,
      response: { error: { code: 'RESILIENCE_UNAVAILABLE' } },
    });
    // The upstream body is discarded entirely rather than trimmed.
    await client(url)
      .readiness(request)
      .catch((error: HttpException) => {
        expect(JSON.stringify(error.getResponse())).not.toContain(
          'ECONNREFUSED',
        );
        expect(JSON.stringify(error.getResponse())).not.toContain('Prisma');
      });
  });

  it('preserves a conflict so the console can tell the operator to refresh', async () => {
    const url = await serve(() => ({
      status: 409,
      body: { error: { code: 'INVALID_DRILL_TRANSITION' } },
    }));
    await expect(
      client(url).acknowledge(
        request,
        'drill:1',
        'operator:one',
        'reason text',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { error: { code: 'RESILIENCE_STATE_CONFLICT' } },
    });
  });

  it('preserves a not-found so a stale bookmark does not read as an outage', async () => {
    const url = await serve(() => ({ status: 404, body: {} }));
    await expect(
      client(url).drill(request, 'drill:missing'),
    ).rejects.toMatchObject({
      status: 404,
      response: { error: { code: 'RESILIENCE_RECORD_NOT_FOUND' } },
    });
  });

  it('aborts a stalled upstream within its timeout instead of holding the request', async () => {
    const url = await serve(() => 'stall');
    const startedAt = Date.now();
    await expect(client(url, 300).readiness(request)).rejects.toMatchObject({
      status: 503,
    });
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it('refuses a 200 response carrying a field the contract does not allow', async () => {
    // The upstream service is trusted to be careful; this boundary does not
    // rely on it. A leaked `databaseUrl` fails validation and becomes a 503
    // rather than reaching an operator's browser.
    const url = await serve(() => ({
      status: 200,
      body: {
        ...READINESS,
        databaseUrl:
          'postgresql://aegis_resilience:leaked-password@10.0.0.7:5432/aegis_resilience',
      },
    }));
    let leaked = '';
    await client(url)
      .readiness(request)
      .catch((error: HttpException) => {
        leaked = JSON.stringify(error.getResponse());
      });
    expect(leaked).toContain('RESILIENCE_UNAVAILABLE');
    expect(leaked).not.toContain('leaked-password');
    expect(leaked).not.toContain('postgresql://');
  });

  it('reports a refused connection as unavailable rather than throwing a socket error', async () => {
    const url = await serve(() => ({ status: 200, body: READINESS }));
    await new Promise<void>((settle) => {
      const server = servers.at(-1)!;
      server.closeAllConnections();
      server.close(() => settle());
    });
    await expect(client(url).readiness(request)).rejects.toMatchObject({
      status: 503,
      response: { error: { code: 'RESILIENCE_UNAVAILABLE' } },
    });
  });

  it('recovers on the next call once the service is back', async () => {
    let available = false;
    const url = await serve(() =>
      available
        ? { status: 200, body: READINESS }
        : { status: 503, body: { error: { code: 'UNAVAILABLE' } } },
    );
    await expect(client(url).readiness(request)).rejects.toMatchObject({
      status: 503,
    });
    available = true;
    // No circuit state to reset: a recovered service is usable immediately.
    await expect(client(url).readiness(request)).resolves.toMatchObject({
      platformState: 'HEALTHY',
    });
  });

  it('encodes identifiers into the upstream path rather than interpolating them raw', async () => {
    const url = await serve(() => ({ status: 404, body: {} }));
    requests.length = 0;
    await client(url)
      .drill(request, 'drill:2026-08-01:ab/../cd')
      .catch(() => undefined);
    expect(requests[0]?.path).toBe(
      '/internal/v1/drills/drill%3A2026-08-01%3Aab%2F..%2Fcd',
    );
  });
});
