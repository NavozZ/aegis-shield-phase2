import { INestApplication, ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { GatewayExceptionFilter } from './common/http/gateway-exception.filter';
import { LOCAL_WEB_ORIGIN } from './constants/application.constants';

export function configureApplication(app: INestApplication): void {
  app.use(helmet());
  app.use(json({ limit: '32kb', strict: true }));
  app.use(urlencoded({ extended: false, limit: '16kb' }));
  app.enableCors({
    credentials: true,
    methods: ['GET', 'POST', 'HEAD', 'OPTIONS'],
    origin: LOCAL_WEB_ORIGIN,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      whitelist: true,
    }),
  );
  app.useGlobalFilters(new GatewayExceptionFilter());
  app.enableShutdownHooks();
}
