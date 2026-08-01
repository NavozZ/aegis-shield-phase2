import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './app.setup';
import {
  loadRootEnvironment,
  PAYMENTS_CONFIG,
  type PaymentsConfig,
} from './common/config/payments.config';
async function bootstrap() {
  loadRootEnvironment();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApplication(app);
  const config = app.get<PaymentsConfig>(PAYMENTS_CONFIG);
  await app.listen(config.port, config.host);
  Logger.log(
    `Listening on http://${config.host}:${config.port}`,
    'payments-service',
  );
}
void bootstrap().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : 'Unknown startup error',
    undefined,
    'payments-service',
  );
  process.exitCode = 1;
});
