import { Module } from '@nestjs/common';
import { PaymentsSabclInboundController } from './sabcl-inbound.controller';
import { PaymentsSabclService } from './sabcl.service';

@Module({
  controllers: [PaymentsSabclInboundController],
  providers: [PaymentsSabclService],
  exports: [PaymentsSabclService],
})
export class PaymentsSabclModule {}
