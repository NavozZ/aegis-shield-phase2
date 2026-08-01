import { Global, Module } from '@nestjs/common';
import { RiskClient } from './risk.client';
@Global()
@Module({ providers: [RiskClient], exports: [RiskClient] })
export class RiskModule {}
