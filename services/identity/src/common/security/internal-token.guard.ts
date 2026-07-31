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
  IDENTITY_CONFIG,
  type IdentityConfig,
} from '../config/identity.config';
import { PUBLIC_ROUTE_KEY } from './public.decorator';
import { timingSafeStringEqual } from './security';

@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const supplied = request.header('x-aegis-internal-token')?.trim() || '';
    if (!timingSafeStringEqual(supplied, this.config.internalToken)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
