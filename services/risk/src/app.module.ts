import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AssessmentsModule } from './assessments/assessments.module';
import { RiskConfigModule } from './common/config/config.module';
import { InternalTokenGuard } from './common/security/internal-token.guard';
import { ControlsModule } from './controls/controls.module';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.module';
import { IncidentsModule } from './incidents/incidents.module';
import { OperatorsModule } from './operators/operators.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { RedisModule } from './redis/redis.module';
import { RetentionModule } from './retention/retention.module';
@Module({
  imports: [
    RiskConfigModule,
    DatabaseModule,
    RedisModule,
    HealthModule,
    EventsModule,
    AssessmentsModule,
    ControlsModule,
    IncidentsModule,
    OperatorsModule,
    ReconciliationModule,
    RetentionModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: InternalTokenGuard }],
})
export class AppModule {}
