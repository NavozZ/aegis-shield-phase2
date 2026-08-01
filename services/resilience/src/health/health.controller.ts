import type {
  RecoveryReadiness,
  ResilienceHealthState,
} from '@aegis/contracts';
import { Controller, Get, Inject } from '@nestjs/common';
import {
  RESILIENCE_CONFIG,
  type ResilienceConfig,
} from '../common/config/resilience.config';
import { PublicRoute } from '../common/security/public.decorator';
import { PrismaService } from '../database/prisma.service';
import { DrillService } from '../drills/drill.service';

/*
 * Health, readiness and recovery readiness.
 *
 * Readiness distinguishes "the process is alive" from "this service can do its
 * job", because an operator console that shows green while PostgreSQL is
 * unreachable is worse than one that shows nothing.
 *
 * Nothing here reveals how to reach anything: no database URL, no host, no
 * token, no stack trace. A dependency is a name, a kind and a state.
 */
@Controller()
export class HealthController {
  constructor(
    @Inject(RESILIENCE_CONFIG) private readonly config: ResilienceConfig,
    private readonly prisma: PrismaService,
    private readonly drills: DrillService,
  ) {}

  /** Liveness: the process is running. Deliberately says nothing more. */
  @Get('health/live')
  @PublicRoute()
  live() {
    return { status: 'ok' };
  }

  @Get('health/ready')
  @PublicRoute()
  async ready() {
    const databaseReachable = await this.prisma.isHealthy();
    return {
      status: databaseReachable ? 'ok' : 'degraded',
      configurationValid: true,
      database: databaseReachable ? 'ok' : 'unavailable',
      // Whether a key is present, never the key.
      backupKeyConfigured: this.config.backupKeyConfigured,
    };
  }

  /**
   * The document the operator console renders.
   *
   * Dependency probes are bounded and failures are folded into a state rather
   * than propagated, so one unreachable service degrades the report instead of
   * failing it.
   */
  @Get('internal/v1/readiness')
  async readiness(): Promise<RecoveryReadiness> {
    const checkedAt = new Date().toISOString();
    const databaseReachable = await this.prisma.isHealthy();

    const dependencies = await Promise.all(
      this.config.dependencies.map(async (dependency) => ({
        name: dependency.name,
        kind: 'HTTP_SERVICE' as const,
        state: (await this.probe(dependency.url, dependency.timeoutMs))
          ? ('HEALTHY' as ResilienceHealthState)
          : ('UNAVAILABLE' as ResilienceHealthState),
        checkedAt,
      })),
    );

    const services = dependencies.map((dependency) => ({
      service: dependency.name,
      state: dependency.state,
      failureCode:
        dependency.state === 'UNAVAILABLE'
          ? ('DEPENDENCY_UNAVAILABLE' as const)
          : null,
      checkedAt,
    }));

    const unavailable = dependencies.filter(
      (item) => item.state === 'UNAVAILABLE',
    );
    const platformState: ResilienceHealthState = !databaseReachable
      ? 'UNAVAILABLE'
      : unavailable.length === 0
        ? 'HEALTHY'
        : 'DEGRADED';

    return {
      platformState,
      services,
      dependencies: [
        {
          name: 'resilience-postgres',
          kind: 'POSTGRES',
          state: databaseReachable ? 'HEALTHY' : 'UNAVAILABLE',
          checkedAt,
        },
        ...dependencies,
      ],
      latestBackup: await this.drills.latestBackup(),
      latestDrill: await this.drills.latestDrill(),
      generatedAt: checkedAt,
    };
  }

  /**
   * One bounded liveness probe.
   *
   * `connection: close` and draining the body keep Node's keep-alive pool from
   * holding sockets open past the request, which would otherwise show up as a
   * leak in tests and as idle connections in operation.
   */
  private async probe(baseUrl: string, timeoutMs: number): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(new URL('/health/live', baseUrl), {
        headers: { connection: 'close' },
        signal: controller.signal,
      });
      await response.arrayBuffer().catch(() => undefined);
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
