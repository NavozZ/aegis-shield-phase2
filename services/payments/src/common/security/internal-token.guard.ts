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
  PAYMENTS_CONFIG,
  type PaymentsConfig,
} from '../config/payments.config';
import { timingSafeStringEqual } from './security';
export const PUBLIC_ROUTE_KEY = 'aegis:public';
@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig,
  ) {}
  canActivate(context: ExecutionContext): boolean {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (
      !timingSafeStringEqual(
        request.header('x-aegis-internal-token')?.trim() || '',
        this.config.internalToken,
      )
    )
      throw new UnauthorizedException();
    return true;
  }
}
