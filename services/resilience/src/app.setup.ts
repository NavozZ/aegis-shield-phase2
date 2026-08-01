import { INestApplication } from '@nestjs/common';
import { json } from 'express';
import helmet from 'helmet';
import { StructuredExceptionFilter } from './common/http/structured-exception.filter';

/**
 * The service accepts small JSON documents from trusted internal callers only.
 * There is no urlencoded parser and no CORS, because nothing in a browser talks
 * to this service directly.
 */
export function configureApplication(app: INestApplication): void {
  app.use(helmet());
  app.use(json({ limit: '64kb', strict: true }));
  app.useGlobalFilters(new StructuredExceptionFilter());
  app.enableShutdownHooks();
}
