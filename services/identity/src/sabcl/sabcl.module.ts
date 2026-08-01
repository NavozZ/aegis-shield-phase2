import { Module } from '@nestjs/common';
import { IdentitySabclInboundController } from './sabcl-inbound.controller';
import { IdentitySabclService } from './sabcl.service';

@Module({
  controllers: [IdentitySabclInboundController],
  providers: [IdentitySabclService],
  exports: [IdentitySabclService],
})
export class IdentitySabclModule {}
