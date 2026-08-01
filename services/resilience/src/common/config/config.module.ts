import { Global, Module } from '@nestjs/common';
import { RESILIENCE_CONFIG, createResilienceConfig } from './resilience.config';

/**
 * Configuration is built once during bootstrap, so an invalid token, an unsafe
 * production setting or a malformed backup key stops the process rather than
 * surfacing on the first request.
 */
@Global()
@Module({
  providers: [
    { provide: RESILIENCE_CONFIG, useFactory: createResilienceConfig },
  ],
  exports: [RESILIENCE_CONFIG],
})
export class ResilienceConfigModule {}
