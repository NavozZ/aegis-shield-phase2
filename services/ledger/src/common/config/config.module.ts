import { Global, Module } from '@nestjs/common';
import { createLedgerConfig, LEDGER_CONFIG } from './ledger.config';

@Global()
@Module({
  providers: [{ provide: LEDGER_CONFIG, useFactory: createLedgerConfig }],
  exports: [LEDGER_CONFIG],
})
export class LedgerConfigModule {}
