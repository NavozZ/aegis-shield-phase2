import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  RESILIENCE_CONFIG,
  type ResilienceConfig,
} from '../config/resilience.config';
import { PUBLIC_ROUTE_KEY } from './public.decorator';
import { timingSafeStringEqual } from './security';

/**
 * Internal authentication.
 *
 * Two credentials, matching the source-specific model the Risk service already
 * uses rather than one unrestricted token shared by every caller:
 *
 *   - `x-aegis-internal-token` — trusted internal callers.
 *   - `x-aegis-source-token`   — identifies *which* caller, so Gateway traffic
 *     and operator tooling can be told apart and revoked independently.
 *
 * Both are compared in constant time, and an unknown source is refused rather
 * than falling back to the shared token.
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RESILIENCE_CONFIG) private readonly config: ResilienceConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const internal = request.header('x-aegis-internal-token')?.trim() || '';
    if (timingSafeStringEqual(internal, this.config.internalToken)) {
      return true;
    }

    const source = request.header('x-aegis-source-token')?.trim() || '';
    for (const candidate of Object.values(this.config.sourceTokens)) {
      if (timingSafeStringEqual(source, candidate)) return true;
    }

    // One shape of failure for every reason, so probing cannot distinguish an
    // unknown source from a wrong token.
    throw new UnauthorizedException();
  }
}
