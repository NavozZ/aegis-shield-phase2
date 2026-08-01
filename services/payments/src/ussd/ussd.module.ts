import { Module } from '@nestjs/common';
import { PaymentsConfigModule } from '../common/config/config.module';
import { DatabaseModule } from '../database/database.module';
import { LedgerClient } from '../transfers/ledger.client';
import { UssdController } from './ussd.controller';
import { UssdService } from './ussd.service';

/**
 * UssdService injects LedgerClient, which is not a global provider — it is
 * declared per module, the same way QrModule and AgentModule declare it.
 *
 * Without it here the entire Payments application fails to bootstrap, because
 * Nest resolves every provider at startup rather than on first use. The unit
 * suites did not catch it: they construct UssdService directly with test
 * doubles and never boot AppModule.
 */
@Module({
  imports: [PaymentsConfigModule, DatabaseModule],
  controllers: [UssdController],
  providers: [UssdService, LedgerClient],
  exports: [UssdService],
})
export class UssdModule {}
