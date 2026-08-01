import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './app.setup';
import {
  loadRootEnvironment,
  ROUTER_CONFIG,
  type RouterConfig,
} from './common/config/router.config';

async function bootstrap() {
  loadRootEnvironment();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApplication(app);
  const config = app.get<RouterConfig>(ROUTER_CONFIG);
  await app.listen(config.port, config.host);
  // Mode and protocol version only. Key identifiers are available on the status
  // endpoint; the startup line is not the place to enumerate them.
  Logger.log(
    `Listening on http://${config.host}:${config.port} in ${config.sabcl.mode} mode`,
    'sabcl-router',
  );
}

void bootstrap().catch((error: unknown) => {
  // A configuration failure must be loud and fatal. Starting a router that
  // cannot authenticate senders would be worse than not starting at all.
  Logger.error(
    error instanceof Error ? error.message : 'Unknown startup error',
    undefined,
    'sabcl-router',
  );
  process.exitCode = 1;
});
