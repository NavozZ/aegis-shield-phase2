import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PaymentsConfigModule } from './common/config/config.module';
import { InternalTokenGuard } from './common/security/internal-token.guard';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { TransfersModule } from './transfers/transfers.module';
import { QrModule } from './qr/qr.module';
import { AgentModule } from './agent/agent.module';
import { UssdModule } from './ussd/ussd.module';

@Module({
  imports: [
    PaymentsConfigModule,
    DatabaseModule,
    HealthModule,
    TransfersModule,
    QrModule,
    AgentModule,
    UssdModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: InternalTokenGuard }],
})
export class AppModule {}
