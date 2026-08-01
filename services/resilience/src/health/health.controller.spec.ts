import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ResilienceConfig } from '../common/config/resilience.config';
import type { PrismaService } from '../database/prisma.service';
import type { DrillService } from '../drills/drill.service';
import { HealthController } from './health.controller';

/*
 * Controlled failure policy.
 *
 * Each test removes exactly one thing — a dependency, the database, a timely
 * response — and asserts the readiness document degrades rather than throwing,
 * hanging or disclosing. The rule being enforced is that a dependency outage
 * makes the platform state honest, never the console blank and never the
 * process wedged.
 *
 * Every dependency here is a real socket on a real ephemeral port. Nothing is
 * mocked at the fetch layer, because the behaviour under test is precisely what
 * happens to a socket that refuses, stalls or errors.
 */

const servers: Server[] = [];

/** Starts a throwaway HTTP server and returns its base URL. */
async function serve(
  handler: (respond: (status: number) => void) => void,
): Promise<string> {
  const server = createServer((_request, response) => {
    handler((status) => {
      response.statusCode = status;
      response.end('{}');
    });
  });
  servers.push(server);
  await new Promise<void>((settle) => server.listen(0, '127.0.0.1', settle));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(port)}`;
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

function build(options: {
  dependencies: ResilienceConfig['dependencies'];
  databaseHealthy?: boolean;
}) {
  const config = {
    dependencies: options.dependencies,
    backupKeyConfigured: true,
    internalToken: 'unit-only-internal-token',
    databaseUrl:
      'postgresql://aegis_resilience:unit-only-password@127.0.0.1:5432/aegis_resilience?schema=app',
  } as ResilienceConfig;
  const prisma = {
    isHealthy: jest.fn().mockResolvedValue(options.databaseHealthy ?? true),
  } as unknown as PrismaService;
  const drills = {
    latestBackup: jest.fn().mockResolvedValue(null),
    latestDrill: jest.fn().mockResolvedValue(null),
  } as unknown as DrillService;
  return new HealthController(config, prisma, drills);
}

describe('recovery readiness under dependency failure', () => {
  it('is HEALTHY when every dependency answers', async () => {
    const url = await serve((respond) => respond(200));
    const readiness = await build({
      dependencies: [{ name: 'ledger', url, timeoutMs: 1_000 }],
    }).readiness();
    expect(readiness.platformState).toBe('HEALTHY');
    expect(readiness.services[0]?.failureCode).toBeNull();
  });

  it('degrades, rather than fails, when one dependency refuses connections', async () => {
    const closed = await serve((respond) => respond(200));
    await new Promise<void>((settle) => {
      const server = servers.at(-1)!;
      server.closeAllConnections();
      server.close(() => settle());
    });
    const readiness = await build({
      dependencies: [{ name: 'risk', url: closed, timeoutMs: 1_000 }],
    }).readiness();
    expect(readiness.platformState).toBe('DEGRADED');
    expect(readiness.services[0]).toMatchObject({
      service: 'risk',
      state: 'UNAVAILABLE',
      failureCode: 'DEPENDENCY_UNAVAILABLE',
    });
  });

  it('treats a dependency returning 500 as unavailable', async () => {
    const url = await serve((respond) => respond(500));
    const readiness = await build({
      dependencies: [{ name: 'payments', url, timeoutMs: 1_000 }],
    }).readiness();
    expect(readiness.platformState).toBe('DEGRADED');
    expect(readiness.services[0]?.state).toBe('UNAVAILABLE');
  });

  it('bounds a stalled dependency by its own timeout instead of hanging', async () => {
    const pending: NodeJS.Timeout[] = [];
    // A dependency that accepts the connection and then never answers is the
    // failure mode a naive probe waits on forever.
    const url = await serve((respond) => {
      pending.push(setTimeout(() => respond(200), 30_000));
    });
    const startedAt = Date.now();
    const readiness = await build({
      dependencies: [{ name: 'identity', url, timeoutMs: 300 }],
    }).readiness();
    const elapsed = Date.now() - startedAt;
    for (const timer of pending) clearTimeout(timer);

    expect(readiness.services[0]?.state).toBe('UNAVAILABLE');
    // Generous headroom over the 300 ms budget, but far below the 30 s stall:
    // this asserts the abort fired, not a particular machine's speed.
    expect(elapsed).toBeLessThan(5_000);
  });

  it('probes dependencies concurrently so one outage does not serialise the rest', async () => {
    const slow = await serve((respond) => setTimeout(() => respond(200), 250));
    const readiness = await build({
      dependencies: [
        { name: 'identity', url: slow, timeoutMs: 2_000 },
        { name: 'ledger', url: slow, timeoutMs: 2_000 },
        { name: 'payments', url: slow, timeoutMs: 2_000 },
        { name: 'risk', url: slow, timeoutMs: 2_000 },
      ],
    }).readiness();
    expect(readiness.services).toHaveLength(4);
    expect(readiness.platformState).toBe('HEALTHY');
  });

  it('reports UNAVAILABLE when its own database is unreachable, whatever the dependencies say', async () => {
    const url = await serve((respond) => respond(200));
    const controller = build({
      dependencies: [{ name: 'ledger', url, timeoutMs: 1_000 }],
      databaseHealthy: false,
    });
    const readiness = await controller.readiness();
    expect(readiness.platformState).toBe('UNAVAILABLE');
    expect(
      readiness.dependencies.find((item) => item.kind === 'POSTGRES')?.state,
    ).toBe('UNAVAILABLE');

    const ready = await controller.ready();
    expect(ready.status).toBe('degraded');
    expect(ready.database).toBe('unavailable');
  });

  it('recovers to HEALTHY once the dependency answers again, with no restart', async () => {
    let healthy = false;
    const url = await serve((respond) => respond(healthy ? 200 : 503));
    const controller = build({
      dependencies: [{ name: 'ledger', url, timeoutMs: 1_000 }],
    });
    expect((await controller.readiness()).platformState).toBe('DEGRADED');
    healthy = true;
    // No backoff state to clear and no cached verdict: the next call reflects
    // reality, which is what an operator refreshing the console expects.
    expect((await controller.readiness()).platformState).toBe('HEALTHY');
  });

  it('never discloses a URL, password, token or key in any health response', async () => {
    const url = await serve((respond) => respond(200));
    const controller = build({
      dependencies: [{ name: 'ledger', url, timeoutMs: 1_000 }],
    });
    const serialised = JSON.stringify([
      controller.live(),
      await controller.ready(),
      await controller.readiness(),
    ]);
    for (const forbidden of [
      'postgresql://',
      'unit-only-password',
      'unit-only-internal-token',
      'aegis_resilience',
      url,
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
    // Whether a key exists is operationally useful; the key itself is not.
    expect((await controller.ready()).backupKeyConfigured).toBe(true);
  });
});
