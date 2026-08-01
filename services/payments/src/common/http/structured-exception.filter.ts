import {
  ArgumentsHost,
  Catch,
  HttpException,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PaymentsError } from '../errors/payments.error';

@Catch()
export class StructuredExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('PaymentsErrors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const correlationId = request.header('x-correlation-id')?.trim();
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'The transfer could not be completed.';

    if (exception instanceof PaymentsError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = status === 401 ? 'UNAUTHENTICATED' : 'INVALID_REQUEST';
      message = status >= 500 ? message : 'The request is invalid.';
    }
    if (status >= 500) {
      this.logger.error(
        JSON.stringify({
          correlationId: correlationId ?? undefined,
          errorName:
            exception instanceof Error
              ? exception.constructor.name
              : 'UnknownError',
        }),
      );
    }
    response.status(status).json({
      error: { code, message, correlationId: correlationId ?? null },
    });
  }
}
