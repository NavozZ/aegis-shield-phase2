import type {
  LedgerAccountClass,
  Money,
  PostingDirection,
} from '@aegis/contracts';

/**
 * Every monetary value inside the Ledger service is a BigInt count of minor
 * units. Values cross service boundaries as decimal strings, never as
 * JavaScript numbers, because a balance can exceed Number.MAX_SAFE_INTEGER.
 */
export function parseMinorUnits(value: string): bigint {
  if (!/^-?(?:0|[1-9]\d{0,23})$/u.test(value)) {
    throw new TypeError('Minor units must be a whole-number string.');
  }
  return BigInt(value);
}

export function serializeMinorUnits(value: bigint): string {
  return value.toString(10);
}

export function toMoney(currency: string, minorUnits: bigint): Money {
  return { currency, minorUnits: serializeMinorUnits(minorUnits) };
}

const DEBIT_POSITIVE_CLASSES: ReadonlySet<LedgerAccountClass> = new Set([
  'ASSET',
  'EXPENSE',
]);

/**
 * Signed balance for an account class.
 *
 * ASSET and EXPENSE increase on the debit side. LIABILITY, EQUITY and REVENUE
 * increase on the credit side, which is why a customer wallet — a liability of
 * the platform — grows when it is credited.
 */
export function signedBalanceMinor(
  accountClass: LedgerAccountClass,
  debitTotalMinor: bigint,
  creditTotalMinor: bigint,
): bigint {
  return DEBIT_POSITIVE_CLASSES.has(accountClass)
    ? debitTotalMinor - creditTotalMinor
    : creditTotalMinor - debitTotalMinor;
}

export function applyDirection(
  direction: PostingDirection,
  amountMinor: bigint,
  totals: { debitTotalMinor: bigint; creditTotalMinor: bigint },
): { debitTotalMinor: bigint; creditTotalMinor: bigint } {
  return direction === 'DEBIT'
    ? {
        debitTotalMinor: totals.debitTotalMinor + amountMinor,
        creditTotalMinor: totals.creditTotalMinor,
      }
    : {
        debitTotalMinor: totals.debitTotalMinor,
        creditTotalMinor: totals.creditTotalMinor + amountMinor,
      };
}
