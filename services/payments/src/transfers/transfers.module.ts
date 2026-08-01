import { Module } from '@nestjs/common';
import { LedgerClient } from './ledger.client';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';
import { PaymentsReconciliationService } from '../reconciliation/payments-reconciliation.service';
import { PaymentsRiskClient } from './risk.client';
@Module({
  controllers: [TransfersController],
  providers: [
    LedgerClient,
    PaymentsRiskClient,
    TransfersService,
    PaymentsReconciliationService,
  ],
  exports: [TransfersService, PaymentsReconciliationService],
})
export class TransfersModule {}
