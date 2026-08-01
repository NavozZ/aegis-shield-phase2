import { Module } from '@nestjs/common';
import { RiskModule } from '../risk/risk.module';
import { OperatorsController } from './operators.controller';
@Module({ imports: [RiskModule], controllers: [OperatorsController] })
export class OperatorsModule {}
