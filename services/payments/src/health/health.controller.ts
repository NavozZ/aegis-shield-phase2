import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../database/prisma.service';
import { PublicRoute } from '../common/security/public.decorator';
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Get() @PublicRoute() health() {
    return { status: 'ok', service: 'payments' } as const;
  }
  @Get('live') @PublicRoute() live() {
    return { status: 'ok', service: 'payments' } as const;
  }
  @Get('ready') async ready(@Res({ passthrough: true }) response: Response) {
    const postgres = await this.prisma.isHealthy();
    response.status(postgres ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: postgres ? 'ready' : 'not_ready',
      service: 'payments',
      dependencies: { postgres: postgres ? 'up' : 'down' },
    };
  }
}
