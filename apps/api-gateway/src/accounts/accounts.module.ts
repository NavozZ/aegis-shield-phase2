import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccountsController } from './accounts.controller';
import { LedgerClient } from './ledger.client';
import { SessionCustomerResolver } from './session-customer';

@Module({
  imports: [AuthModule],
  controllers: [AccountsController],
  providers: [LedgerClient, SessionCustomerResolver],
  exports: [LedgerClient],
})
export class AccountsModule {}
