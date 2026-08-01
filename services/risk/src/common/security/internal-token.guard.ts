import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RISK_CONFIG, type RiskConfig } from '../config/risk.config';
import { PUBLIC_ROUTE_KEY } from './public.decorator';
import { timingSafeStringEqual } from './security';
@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RISK_CONFIG) private readonly config: RiskConfig,
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
