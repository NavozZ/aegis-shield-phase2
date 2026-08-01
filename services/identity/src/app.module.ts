import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { IdentityConfigModule } from './common/config/config.module';
import { CorrelationMiddleware } from './common/http/correlation.middleware';
import { InternalTokenGuard } from './common/security/internal-token.guard';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';
import { IdentitySabclModule } from './sabcl/sabcl.module';

@Module({
  imports: [
    IdentityConfigModule,
    DatabaseModule,
    RedisModule,
    HealthModule,
    AuthModule,
    IdentitySabclModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: InternalTokenGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
