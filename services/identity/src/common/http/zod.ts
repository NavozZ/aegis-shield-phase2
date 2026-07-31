import { type ZodType } from 'zod';
import { AuthError } from '../errors/auth.error';

export function parseInput<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AuthError('INVALID_REQUEST', 'The request is invalid.', 400);
  }
  return result.data;
}
