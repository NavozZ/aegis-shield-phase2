import { correlationIdSchema } from '@aegis/contracts';
import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import type { RequestContext } from './request-context';

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  private readonly logger = new Logger('GatewayHttp');

  use(request: RequestContext, response: Response, next: NextFunction): void {
    const supplied = request.header('x-correlation-id');
    request.correlationId = correlationIdSchema.safeParse(supplied).success
      ? supplied!
      : randomUUID();
    response.setHeader('x-correlation-id', request.correlationId);
    const startedAt = Date.now();
    response.on('finish', () => {
      this.logger.log(
        JSON.stringify({
          correlationId: request.correlationId,
          method: request.method,
          path: request.path,
          statusCode: response.statusCode,
          durationMs: Date.now() - startedAt,
        }),
      );
    });
    next();
  }
}
