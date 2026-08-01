import { Module } from '@nestjs/common';
import { LedgerSabclInboundController } from './sabcl-inbound.controller';
import { LedgerSabclService } from './sabcl.service';

@Module({
  controllers: [LedgerSabclInboundController],
  providers: [LedgerSabclService],
  exports: [LedgerSabclService],
})
export class LedgerSabclModule {}
