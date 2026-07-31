import { Global, Module } from '@nestjs/common';
import { createIdentityConfig, IDENTITY_CONFIG } from './identity.config';

@Global()
@Module({
  providers: [{ provide: IDENTITY_CONFIG, useFactory: createIdentityConfig }],
  exports: [IDENTITY_CONFIG],
})
export class IdentityConfigModule {}
