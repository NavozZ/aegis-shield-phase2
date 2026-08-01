import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AuthModule } from '../auth/auth.module';
import { TransfersModule } from '../transfers/transfers.module';
import { HealthController } from './health.controller';

@Module({
  imports: [AuthModule, AccountsModule, TransfersModule],
  controllers: [HealthController],
})
export class HealthModule {}
