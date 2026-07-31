import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AuthModule } from '../auth/auth.module';
import { HealthController } from './health.controller';

@Module({
  imports: [AuthModule, AccountsModule],
  controllers: [HealthController],
})
export class HealthModule {}
