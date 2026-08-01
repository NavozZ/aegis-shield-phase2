import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PublicRoute } from '../common/security/public.decorator';
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}
  @PublicRoute() @Get('live') live() {
    return { status: 'ok', service: 'risk' };
  }
  @Get('ready') async ready() {
    const [postgres, redis] = await Promise.all([
      this.prisma.isHealthy(),
      this.redis.isHealthy(),
    ]);
    if (!postgres || !redis)
      throw new HttpException(
        { status: 'unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    return { status: 'ready', dependencies: { postgres, redis } };
  }
}
