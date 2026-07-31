import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './app.setup';
import {
  IDENTITY_CONFIG,
  type IdentityConfig,
  loadRootEnvironment,
} from './common/config/identity.config';

async function bootstrap(): Promise<void> {
  loadRootEnvironment();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApplication(app);
  const config = app.get<IdentityConfig>(IDENTITY_CONFIG);
  await app.listen(config.port, config.host);
  Logger.log(
    `Listening on http://${config.host}:${config.port}`,
    'identity-service',
  );
}

bootstrap().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : 'Unknown startup error',
    undefined,
    'identity-service',
  );
  process.exitCode = 1;
});
