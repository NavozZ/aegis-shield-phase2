import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { LedgerConfig } from '../config/ledger.config';
import { InternalTokenGuard } from './internal-token.guard';

const config = { internalToken: 'internal-token-value' } as LedgerConfig;

function contextWithToken(token?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ header: () => token }),
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('InternalTokenGuard', () => {
  const reflector = new Reflector();
  const guard = new InternalTokenGuard(reflector, config);

  beforeEach(() => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts the configured internal token', () => {
    expect(guard.canActivate(contextWithToken('internal-token-value'))).toBe(
      true,
    );
  });

  it('rejects a missing internal token', () => {
    expect(() => guard.canActivate(contextWithToken(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an empty internal token', () => {
    expect(() => guard.canActivate(contextWithToken('   '))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an incorrect internal token', () => {
    expect(() =>
      guard.canActivate(contextWithToken('wrong-token-value')),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a token that only shares a prefix', () => {
    expect(() => guard.canActivate(contextWithToken('internal-token'))).toThrow(
      UnauthorizedException,
    );
  });

  it('allows routes explicitly marked public', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    expect(guard.canActivate(contextWithToken(undefined))).toBe(true);
  });
});
