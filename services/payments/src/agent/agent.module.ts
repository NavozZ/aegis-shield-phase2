import { Module } from '@nestjs/common';
import { PaymentsConfigModule } from '../common/config/config.module';
import { DatabaseModule } from '../database/database.module';
import { LedgerClient } from '../transfers/ledger.client';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';

@Module({
  imports: [PaymentsConfigModule, DatabaseModule],
  controllers: [AgentController],
  providers: [AgentService, LedgerClient],
  exports: [AgentService],
})
export class AgentModule {}
