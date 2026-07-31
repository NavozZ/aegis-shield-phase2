import { HttpStatus } from '@nestjs/common';

export class LedgerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = HttpStatus.BAD_REQUEST,
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}

export const invalidRequestError = (): LedgerError =>
  new LedgerError(
    'INVALID_REQUEST',
    'The request is invalid.',
    HttpStatus.BAD_REQUEST,
  );

/**
 * Returned when an account does not exist *or* is not owned by the requesting
 * customer, so that probing identifiers cannot reveal another customer's
 * account.
 */
export const accountNotFoundError = (): LedgerError =>
  new LedgerError(
    'ACCOUNT_NOT_FOUND',
    'The account could not be found.',
    HttpStatus.NOT_FOUND,
  );

export const accountNotActiveError = (): LedgerError =>
  new LedgerError(
    'ACCOUNT_NOT_ACTIVE',
    'The account is not active.',
    HttpStatus.CONFLICT,
  );

export const insufficientFundsError = (): LedgerError =>
  new LedgerError(
    'INSUFFICIENT_FUNDS',
    'The account has insufficient available funds.',
    HttpStatus.CONFLICT,
  );

export const unbalancedJournalError = (): LedgerError =>
  new LedgerError(
    'UNBALANCED_JOURNAL',
    'Journal debits and credits must be equal.',
    HttpStatus.BAD_REQUEST,
  );

export const currencyMismatchError = (): LedgerError =>
  new LedgerError(
    'CURRENCY_MISMATCH',
    'All postings must use the journal currency.',
    HttpStatus.BAD_REQUEST,
  );

export const idempotencyConflictError = (): LedgerError =>
  new LedgerError(
    'IDEMPOTENCY_CONFLICT',
    'This idempotency key was already used with a different request.',
    HttpStatus.CONFLICT,
  );

export const idempotencyInProgressError = (): LedgerError =>
  new LedgerError(
    'IDEMPOTENCY_IN_PROGRESS',
    'An identical request is already being processed.',
    HttpStatus.CONFLICT,
  );
