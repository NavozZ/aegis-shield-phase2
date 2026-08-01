import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './app.setup';
import {
  loadRootEnvironment,
  RISK_CONFIG,
  type RiskConfig,
} from './common/config/risk.config';
async function bootstrap() {
  loadRootEnvironment();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApplication(app);
  const config = app.get<RiskConfig>(RISK_CONFIG);
  await app.listen(config.port, config.host);
  Logger.log(
    `Listening on http://${config.host}:${config.port}`,
    'risk-service',
  );
}
void bootstrap().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : 'Unknown startup error',
    undefined,
    'risk-service',
  );
  process.exitCode = 1;
});
