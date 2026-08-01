import { Module } from '@nestjs/common';
import { ControlController } from './control.controller';
import { ControlService } from './control.service';
import { IdentityControlClient } from './identity-control.client';
@Module({
  controllers: [ControlController],
  providers: [ControlService, IdentityControlClient],
  exports: [ControlService],
})
export class ControlsModule {}
