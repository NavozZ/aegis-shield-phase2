import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicRoute } from '../common/security/public.decorator';
import { PrismaService } from '../database/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness is public so process supervisors and test harnesses can wait for
   * the port to bind. It reports no dependency detail.
   *
   * `/health` and `/health/live` are declared as separate handlers on purpose:
   * stacking two `@Get` decorators on one method registers only the outermost
   * path, silently leaving the other route unrouted.
   */
  @Get()
  @PublicRoute()
  health() {
    return this.liveness();
  }

  @Get('live')
  @PublicRoute()
  live() {
    return this.liveness();
  }

  private liveness() {
    return { status: 'ok', service: 'ledger' } as const;
  }

  /** Readiness requires the internal token because it discloses dependencies. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    const postgres = await this.prisma.isHealthy();
    response.status(postgres ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: postgres ? 'ready' : 'not_ready',
      service: 'ledger',
      dependencies: { postgres: postgres ? 'up' : 'down' },
    };
  }
}
