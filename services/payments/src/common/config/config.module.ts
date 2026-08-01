import { Global, Module } from '@nestjs/common';
import { createPaymentsConfig, PAYMENTS_CONFIG } from './payments.config';
@Global()
@Module({
  providers: [{ provide: PAYMENTS_CONFIG, useFactory: createPaymentsConfig }],
  exports: [PAYMENTS_CONFIG],
})
export class PaymentsConfigModule {}
