import type { INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { StructuredExceptionFilter } from './common/http/structured-exception.filter';
export function configureApplication(app: INestApplication) {
  app.use(helmet());
  app.use(json({ limit: '32kb', strict: true }));
  app.use(urlencoded({ extended: false, limit: '8kb' }));
  app.useGlobalFilters(new StructuredExceptionFilter());
  app.enableShutdownHooks();
}
