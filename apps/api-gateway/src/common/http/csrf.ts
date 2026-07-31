import { HttpException, HttpStatus } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { readCookie } from '../../auth/cookies';

/**
 * Double-submit CSRF check: the token in the request header must equal the
 * token in the non-HttpOnly cookie. Shared by every state-changing route so
 * that the comparison cannot drift between controllers.
 */
export function requireCsrfToken(
  cookieHeader: string | undefined,
  csrfCookieName: string,
  suppliedHeader?: string,
): string {
  const cookieValue = readCookie(cookieHeader, csrfCookieName);
  const supplied = suppliedHeader?.trim() || '';
  const left = Buffer.from(cookieValue);
  const right = Buffer.from(supplied);
  if (
    left.length === 0 ||
    left.length !== right.length ||
    !timingSafeEqual(left, right)
  ) {
    throw new HttpException(
      {
        error: {
          code: 'INVALID_CSRF',
          message: 'The CSRF token is invalid.',
        },
      },
      HttpStatus.FORBIDDEN,
    );
  }
  return supplied;
}
