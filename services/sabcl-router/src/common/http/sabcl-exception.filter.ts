import { SabclError, statusForCode } from '@aegis/sabcl';
import {
  ArgumentsHost,
  Catch,
  HttpException,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * The router's last line of defence against leaking anything.
 *
 * Every failure that escapes a handler becomes a bare protocol code. Note what
 * is absent compared with the services' own filters: no message, no correlation
 * identifier echoed back, no exception name. The router has no legitimate need
 * to tell a caller anything beyond "this envelope was not routed, and here is
 * the protocol-level reason".
 */
@Catch()
export class SabclExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('sabcl-router');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof SabclError) {
      response
        .status(statusForCode(exception.code))
        .json(exception.toSafeResponse());
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json({
        error: {
          code:
            status === 413
              ? 'SABCL_OVERSIZED'
              : status >= 500
                ? 'SABCL_RECIPIENT_UNAVAILABLE'
                : 'SABCL_MALFORMED',
        },
      });
      return;
    }

    // Log the class name only. An unexpected exception's message could contain
    // anything, including material read from a request body.
    this.logger.error(
      JSON.stringify({
        event: 'router.unhandled',
        errorName:
          exception instanceof Error
            ? exception.constructor.name
            : 'UnknownError',
      }),
    );
    response
      .status(500)
      .json({ error: { code: 'SABCL_RECIPIENT_UNAVAILABLE' } });
  }
}
