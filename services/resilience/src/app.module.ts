import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ResilienceConfigModule } from './common/config/config.module';
import { InternalTokenGuard } from './common/security/internal-token.guard';
import { DatabaseModule } from './database/database.module';
import { DrillsModule } from './drills/drills.module';
import { HealthModule } from './health/health.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';

@Module({
  imports: [
    ResilienceConfigModule,
    DatabaseModule,
    DrillsModule,
    HealthModule,
    ReconciliationModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: InternalTokenGuard }],
})
export class AppModule {}
