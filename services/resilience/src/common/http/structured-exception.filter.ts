import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
@Catch()
export class StructuredExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : error instanceof ZodError
          ? HttpStatus.BAD_REQUEST
          : HttpStatus.INTERNAL_SERVER_ERROR;
    const body =
      error instanceof HttpException ? error.getResponse() : undefined;
    response.status(status).json(
      typeof body === 'object'
        ? body
        : {
            error: {
              code: status >= 500 ? 'RISK_UNAVAILABLE' : 'INVALID_REQUEST',
              message:
                status >= 500
                  ? 'Risk service is unavailable.'
                  : 'The request is invalid.',
            },
          },
    );
  }
}
