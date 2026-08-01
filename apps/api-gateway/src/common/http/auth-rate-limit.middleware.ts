import { HttpStatus, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { RequestContext } from './request-context';
import { RiskClient } from '../../risk/risk.client';
import {
  classifyRateLimitBucket,
  RATE_LIMIT_WINDOW_MS,
} from './rate-limit-buckets';

interface RateWindow {
  count: number;
  expiresAt: number;
}

@Injectable()
export class AuthRateLimitMiddleware implements NestMiddleware {
  constructor(private readonly risk: RiskClient) {}
  private readonly windows = new Map<string, RateWindow>();
  private readonly maximumEntries = 10_000;

  use(request: RequestContext, response: Response, next: NextFunction): void {
    const now = Date.now();
    // `originalUrl`, not `path`. Express strips the mount prefix from `path`
    // inside middleware applied with `forRoutes('api/v1/auth/*')`, so `path`
    // here is the remainder rather than the full route. Classifying that
    // remainder put ordinary authentication traffic into the restrictive
    // unclassified bucket. `originalUrl` is the untouched request target; the
    // query string is dropped because it never affects classification.
    const target = (request.originalUrl || request.path).split('?', 1)[0] ?? '';
    // The bucket name comes from a fixed allowlist, never from the raw path, so
    // a caller cannot mint fresh budget by varying a path segment.
    const bucket = classifyRateLimitBucket(target);
    const key = `${request.ip || 'unknown'}:${bucket.name}`;
    const current = this.windows.get(key);
    const window =
      current && current.expiresAt > now
        ? current
        : { count: 0, expiresAt: now + RATE_LIMIT_WINDOW_MS };
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
      String(Math.max(0, bucket.limit - window.count)),
    );
    if (window.count > bucket.limit) {
      // Telemetry is best effort and must never fail the request it describes.
      // `emit` validates against the Risk attribute allowlist and throws
      // synchronously on a mismatch, which would otherwise turn a correct 429
      // into an unhandled error.
      try {
        void this.risk.emit(request, {
          eventType: 'RATE_LIMIT_VIOLATION',
          severity: 'MEDIUM',
          attributes: {
            route: target.slice(0, 256),
            method: request.method,
            requestCount: window.count,
          },
        });
      } catch {
        // Deliberately swallowed: the rate-limit decision below still stands.
      }
      response.status(HttpStatus.TOO_MANY_REQUESTS).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests.',
          correlationId: request.correlationId,
        },
      });
      return;
    }
    next();
  }
}
