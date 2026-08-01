import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AuthModule } from '../auth/auth.module';
import { PaymentsClient } from './payments.client';
import { TransfersController } from './transfers.controller';
@Module({
  imports: [AuthModule, AccountsModule],
  controllers: [TransfersController],
  providers: [PaymentsClient],
  exports: [PaymentsClient],
})
export class TransfersModule {}
