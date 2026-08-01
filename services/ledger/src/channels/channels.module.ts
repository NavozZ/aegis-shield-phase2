import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { JournalModule } from '../ledger/journal.module';
import { ChannelOperationsController } from './channel-operations.controller';
import { ChannelOperationsService } from './channel-operations.service';

@Module({
  imports: [DatabaseModule, JournalModule],
  controllers: [ChannelOperationsController],
  providers: [ChannelOperationsService],
  exports: [ChannelOperationsService],
})
export class ChannelsModule {}
