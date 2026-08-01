import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './app.setup';
import {
  loadRootEnvironment,
  RESILIENCE_CONFIG,
  type ResilienceConfig,
} from './common/config/resilience.config';

async function bootstrap() {
  loadRootEnvironment();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApplication(app);
  const config = app.get<ResilienceConfig>(RESILIENCE_CONFIG);
  await app.listen(config.port, config.host);
  Logger.log(
    `Listening on http://${config.host}:${config.port}`,
    'resilience-service',
  );
}

void bootstrap().catch((error: unknown) => {
  // Configuration failures are fatal. A resilience service that came up unable
  // to reach its own database would report readiness it cannot support.
  Logger.error(
    error instanceof Error ? error.message : 'Unknown startup error',
    undefined,
    'resilience-service',
  );
  process.exitCode = 1;
});
