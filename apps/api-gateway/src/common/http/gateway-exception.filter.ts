import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import type { RequestContext } from './request-context';

@Catch()
export class GatewayExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestContext>();
    const response = http.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body =
      exception instanceof HttpException ? exception.getResponse() : null;
    const upstream =
      typeof body === 'object' && body !== null && 'error' in body
        ? (body as { error?: { code?: unknown; message?: unknown } }).error
        : undefined;
    const message =
      status >= 500
        ? status === 503
          ? 'Authentication is temporarily unavailable.'
          : 'The request could not be completed.'
        : typeof upstream?.message === 'string'
          ? upstream.message
          : 'The request is invalid.';
    const code =
      typeof upstream?.code === 'string'
        ? upstream.code
        : status === 503
          ? 'IDENTITY_UNAVAILABLE'
          : status === 401
            ? 'UNAUTHENTICATED'
            : 'INVALID_REQUEST';

    response.status(status).json({
      error: { code, message, correlationId: request.correlationId },
    });
  }
}
