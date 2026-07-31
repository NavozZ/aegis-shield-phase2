import {
  ArgumentsHost,
  Catch,
  HttpException,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { LedgerError } from '../errors/ledger.error';
import type { RequestContext } from './request-context';

@Catch()
export class StructuredExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('LedgerErrors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestContext>();
    const response = context.getResponse<Response>();

    let status: number = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'The request could not be completed.';

    if (exception instanceof LedgerError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code =
        status === 404
          ? 'NOT_FOUND'
          : status === 401
            ? 'UNAUTHENTICATED'
            : 'INVALID_REQUEST';
      message = status >= 500 ? message : 'The request is invalid.';
    }

    if (status >= 500) {
      // Database messages can quote row values, so only the error class and a
      // constrained error code are ever logged.
      const errorName =
        exception instanceof Error
          ? exception.constructor.name
          : 'UnknownError';
      const candidateCode =
        typeof exception === 'object' &&
        exception !== null &&
        'code' in exception &&
        typeof exception.code === 'string' &&
        /^[A-Z0-9_-]{1,32}$/u.test(exception.code)
          ? exception.code
          : undefined;
      this.logger.error(
        JSON.stringify({
          correlationId: request.correlationId,
          errorName,
          errorCode: candidateCode,
        }),
      );
    }

    response.status(status).json({
      error: {
        code,
        message,
        correlationId: request.correlationId,
      },
    });
  }
}
