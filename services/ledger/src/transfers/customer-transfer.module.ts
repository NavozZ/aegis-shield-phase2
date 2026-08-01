import { Module } from '@nestjs/common';
import { JournalModule } from '../ledger/journal.module';
import { CustomerTransferController } from './customer-transfer.controller';
import { CustomerTransferService } from './customer-transfer.service';
@Module({
  imports: [JournalModule],
  controllers: [CustomerTransferController],
  providers: [CustomerTransferService],
})
export class CustomerTransferModule {}
