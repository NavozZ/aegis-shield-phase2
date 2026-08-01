import { Global, Module } from '@nestjs/common';
import { ROUTER_CONFIG, createRouterConfig } from './router.config';

/**
 * Configuration is built once at startup and shared.
 *
 * Building it here means an invalid key set or an unparseable route table stops
 * the process during bootstrap rather than on the first request.
 */
@Global()
@Module({
  providers: [{ provide: ROUTER_CONFIG, useFactory: createRouterConfig }],
  exports: [ROUTER_CONFIG],
})
export class RouterConfigModule {}
