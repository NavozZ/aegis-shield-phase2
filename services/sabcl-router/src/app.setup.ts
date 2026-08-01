import { INestApplication } from '@nestjs/common';
import { json } from 'express';
import helmet from 'helmet';
import { SabclExceptionFilter } from './common/http/sabcl-exception.filter';

/**
 * The router accepts exactly one content type and one body shape.
 *
 * The size limit is the first defence and runs before any parsing: an
 * oversized envelope is refused by Express, not by the protocol layer. There is
 * no urlencoded parser and no CORS, because nothing in a browser has any
 * business talking to this service.
 */
export function configureApplication(app: INestApplication): void {
  app.use(helmet());
  app.use(
    json({
      limit: '256kb',
      strict: true,
      type: ['application/json', 'application/sabcl-envelope+json'],
    }),
  );
  app.useGlobalFilters(new SabclExceptionFilter());
  app.enableShutdownHooks();
}
