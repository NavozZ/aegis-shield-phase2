import { INestApplication, ValidationPipe } from '@nestjs/common';
import { LOCAL_WEB_ORIGIN } from './constants/application.constants';

export function configureApplication(app: INestApplication): void {
  app.enableCors({
    credentials: false,
    methods: ['GET', 'HEAD', 'OPTIONS'],
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
  app.enableShutdownHooks();
}
