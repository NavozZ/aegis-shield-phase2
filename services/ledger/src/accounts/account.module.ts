import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

@Module({
  imports: [IdempotencyModule],
  controllers: [AccountController],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
