import { Module } from '@nestjs/common';
import { ControlsModule } from '../controls/controls.module';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
@Module({
  imports: [ControlsModule],
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
})
export class ReconciliationModule {}
