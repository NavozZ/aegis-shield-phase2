import { type ZodType } from 'zod';
import { LedgerError } from '../errors/ledger.error';

/**
 * Parses untrusted input and collapses every validation failure into one
 * generic error. Validation detail is deliberately not returned: it would
 * describe the internal shape of ledger requests to a caller.
 */
export function parseInput<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new LedgerError('INVALID_REQUEST', 'The request is invalid.', 400);
  }
  return result.data;
}
