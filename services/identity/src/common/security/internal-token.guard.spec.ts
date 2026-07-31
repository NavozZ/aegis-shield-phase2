import { UnauthorizedException } from '@nestjs/common';
import type { IdentityConfig } from '../config/identity.config';
import { InternalTokenGuard } from './internal-token.guard';

function contextWith(header?: string) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ header: () => header }),
    }),
  } as never;
}

describe('InternalTokenGuard', () => {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
  const guard = new InternalTokenGuard(
    reflector as never,
    {
      internalToken: 'valid-internal-token',
    } as IdentityConfig,
  );

  it('accepts the valid service token', () => {
    expect(guard.canActivate(contextWith('valid-internal-token'))).toBe(true);
  });

  it.each([undefined, '', 'malformed', 'valid-internal-token-extra'])(
    'rejects a missing or incorrect token: %s',
    (token) => {
      expect(() => guard.canActivate(contextWith(token))).toThrow(
        UnauthorizedException,
      );
    },
  );
});
