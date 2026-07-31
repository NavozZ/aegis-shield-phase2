import { HttpStatus } from '@nestjs/common';

export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = HttpStatus.BAD_REQUEST,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export const invalidCredentialsError = (): AuthError =>
  new AuthError(
    'INVALID_CREDENTIALS',
    'Authentication could not be completed.',
    HttpStatus.UNAUTHORIZED,
  );
