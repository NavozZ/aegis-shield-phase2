import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './app.setup';
import { resolveApiPort } from './config/api-port';
import { APPLICATION_NAME } from './constants/application.constants';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApplication(app);

  const port = resolveApiPort();
  await app.listen(port, '127.0.0.1');

  Logger.log(`Listening on http://localhost:${port}`, APPLICATION_NAME);
}

bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown startup error';
  Logger.error(message, undefined, APPLICATION_NAME);
  process.exitCode = 1;
});
