import { HttpStatus, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { RequestContext } from './request-context';

interface RateWindow {
  count: number;
  expiresAt: number;
}

@Injectable()
export class AuthRateLimitMiddleware implements NestMiddleware {
  private readonly windows = new Map<string, RateWindow>();
  private readonly maximumEntries = 10_000;

  use(request: RequestContext, response: Response, next: NextFunction): void {
    const now = Date.now();
    const key = request.ip || 'unknown';
    const current = this.windows.get(key);
    const window =
      current && current.expiresAt > now
        ? current
        : { count: 0, expiresAt: now + 60_000 };
    window.count += 1;
    this.windows.set(key, window);

    if (this.windows.size > this.maximumEntries) {
      for (const [candidate, value] of this.windows) {
        if (value.expiresAt <= now || this.windows.size > this.maximumEntries) {
          this.windows.delete(candidate);
        }
      }
    }
    response.setHeader(
      'ratelimit-remaining',
      String(Math.max(0, 120 - window.count)),
    );
    if (window.count > 120) {
      response.status(HttpStatus.TOO_MANY_REQUESTS).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many authentication requests.',
          correlationId: request.correlationId,
        },
      });
      return;
    }
    next();
  }
}
