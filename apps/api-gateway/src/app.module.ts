import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { AccountsModule } from './accounts/accounts.module';
import { AuthModule } from './auth/auth.module';
import { AuthRateLimitMiddleware } from './common/http/auth-rate-limit.middleware';
import { CorrelationMiddleware } from './common/http/correlation.middleware';
import { GatewayConfigModule } from './config/gateway-config.module';
import { HealthModule } from './health/health.module';
import { GatewaySabclModule } from './sabcl/sabcl.module';
import { TransfersModule } from './transfers/transfers.module';
import { ChannelsModule } from './channels/channels.module';

@Module({
  imports: [
    GatewayConfigModule,
    // Imported before the feature modules so the transport is available to the
    // ledger and payments clients they construct.
    GatewaySabclModule,
    AuthModule,
    AccountsModule,
    TransfersModule,
    HealthModule,
    ChannelsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
    consumer
      .apply(AuthRateLimitMiddleware)
      .forRoutes('api/v1/auth/*', 'api/v1/accounts/*', 'api/v1/transfers/*');
  }
}
