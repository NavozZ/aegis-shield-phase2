import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './app.setup';
import {
  LEDGER_CONFIG,
  type LedgerConfig,
  loadRootEnvironment,
} from './common/config/ledger.config';

async function bootstrap(): Promise<void> {
  loadRootEnvironment();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApplication(app);
  const config = app.get<LedgerConfig>(LEDGER_CONFIG);
  await app.listen(config.port, config.host);
  Logger.log(
    `Listening on http://${config.host}:${config.port}`,
    'ledger-service',
  );
}

bootstrap().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : 'Unknown startup error',
    undefined,
    'ledger-service',
  );
  process.exitCode = 1;
});
