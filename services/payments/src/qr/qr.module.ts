import { Module } from '@nestjs/common';
import { PaymentsConfigModule } from '../common/config/config.module';
import { DatabaseModule } from '../database/database.module';
import { LedgerClient } from '../transfers/ledger.client';
import { QrController } from './qr.controller';
import { QrService } from './qr.service';

@Module({
  imports: [PaymentsConfigModule, DatabaseModule],
  controllers: [QrController],
  providers: [QrService, LedgerClient],
  exports: [QrService],
})
export class QrModule {}
