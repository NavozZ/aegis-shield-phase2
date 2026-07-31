import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicRoute } from '../common/security/public.decorator';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('live')
  @PublicRoute()
  live() {
    return { status: 'ok', service: 'identity' } as const;
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    const [postgres, redis] = await Promise.all([
      this.prisma.isHealthy(),
      this.redis.ping(),
    ]);
    const ready = postgres && redis;
    response.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: ready ? 'ready' : 'not_ready',
      service: 'identity',
      dependencies: {
        postgres: postgres ? 'up' : 'down',
        redis: redis ? 'up' : 'down',
      },
    };
  }
}
