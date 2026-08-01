import { Global, Module } from '@nestjs/common';
import { createRiskConfig, RISK_CONFIG } from './risk.config';
@Global()
@Module({
  providers: [{ provide: RISK_CONFIG, useFactory: createRiskConfig }],
  exports: [RISK_CONFIG],
})
export class RiskConfigModule {}
