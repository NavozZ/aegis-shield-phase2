import { Global, Module } from '@nestjs/common';
import { createGatewayConfig, GATEWAY_CONFIG } from './gateway.config';

@Global()
@Module({
  providers: [{ provide: GATEWAY_CONFIG, useFactory: createGatewayConfig }],
  exports: [GATEWAY_CONFIG],
})
export class GatewayConfigModule {}
