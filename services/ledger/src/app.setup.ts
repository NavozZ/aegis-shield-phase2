import { INestApplication, ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { StructuredExceptionFilter } from './common/http/structured-exception.filter';

export function configureApplication(app: INestApplication): void {
  app.use(helmet());
  app.use(json({ limit: '32kb', strict: true }));
  app.use(urlencoded({ extended: false, limit: '16kb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: false,
      whitelist: true,
    }),
  );
  app.useGlobalFilters(new StructuredExceptionFilter());
  app.enableShutdownHooks();
}
