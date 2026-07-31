import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicRoute } from '../common/security/public.decorator';
import { PrismaService } from '../database/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness is public so process supervisors and the browser test harness can
   * wait for the port to bind. It reports no dependency detail.
   */
  @Get()
  @Get('live')
  @PublicRoute()
  live() {
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
