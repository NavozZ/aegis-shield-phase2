import { Module } from '@nestjs/common';
import { ControlsModule } from '../controls/controls.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { OperatorController } from './operator.controller';
import { OperatorService } from './operator.service';
@Module({
  imports: [ControlsModule, IncidentsModule],
  controllers: [OperatorController],
  providers: [OperatorService],
})
export class OperatorsModule {}
