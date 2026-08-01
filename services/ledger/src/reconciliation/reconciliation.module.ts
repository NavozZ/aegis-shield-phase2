import { Module } from '@nestjs/common';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { LedgerRiskEventClient } from './risk-event.client';

@Module({
  controllers: [ReconciliationController],
  providers: [ReconciliationService, LedgerRiskEventClient],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
