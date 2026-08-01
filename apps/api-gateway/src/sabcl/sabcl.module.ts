import { Global, Module } from '@nestjs/common';
import { SabclStatusController } from './sabcl-status.controller';
import { SabclTransportService } from './sabcl-transport.service';

/**
 * Global so the ledger and payments clients can inject the transport without
 * every feature module importing it.
 */
@Global()
@Module({
  controllers: [SabclStatusController],
  providers: [SabclTransportService],
  exports: [SabclTransportService],
})
export class GatewaySabclModule {}
