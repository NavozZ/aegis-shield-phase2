import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountProductTypeSchema,
  currencyCodeSchema,
  customerAccountSummarySchema,
  formatMinorUnits,
  formatMoney,
  idempotencyKeySchema,
  internalJournalRequestSchema,
  journalMetadataSchema,
  maskedAccountReferenceSchema,
  minorUnitsSchema,
  moneySchema,
  positiveMinorUnitsSchema,
  postingDirectionSchema,
  publicAccountReferenceSchema,
  reconciliationResultSchema,
  signedMinorUnitsSchema,
} from './v1.js';

const accountId = '5b1f0f4a-6c1e-4f3a-9d2b-8e7c6a5b4d3c';
const ledgerAccountId = '9f8e7d6c-5b4a-4392-8271-605f4e3d2c1b';

test('accepts only three-letter uppercase currency codes', () => {
  assert.equal(currencyCodeSchema.parse('LKR'), 'LKR');
  for (const invalid of ['lkr', 'LK', 'LKRR', '123']) {
    assert.equal(currencyCodeSchema.safeParse(invalid).success, false);
  }
});

test('minor units are whole-number strings, never JavaScript numbers', () => {
  assert.equal(minorUnitsSchema.parse('0'), '0');
  assert.equal(minorUnitsSchema.parse('9007199254740993'), '9007199254740993');
  for (const invalid of ['-1', '1.5', '007', '', ' 1', '1e3']) {
    assert.equal(minorUnitsSchema.safeParse(invalid).success, false);
  }
  assert.equal(minorUnitsSchema.safeParse(10 as unknown).success, false);
});

test('posting amounts must be strictly positive', () => {
  assert.equal(positiveMinorUnitsSchema.parse('1'), '1');
  for (const invalid of ['0', '-5', '1.0']) {
    assert.equal(positiveMinorUnitsSchema.safeParse(invalid).success, false);
  }
});

test('signed minor units allow negatives but reject negative zero', () => {
  assert.equal(signedMinorUnitsSchema.parse('-250'), '-250');
  assert.equal(signedMinorUnitsSchema.parse('0'), '0');
  assert.equal(signedMinorUnitsSchema.safeParse('-0').success, false);
});

test('money rejects unknown keys and floating-point amounts', () => {
  assert.deepEqual(moneySchema.parse({ currency: 'LKR', minorUnits: '0' }), {
    currency: 'LKR',
    minorUnits: '0',
  });
  assert.equal(
    moneySchema.safeParse({ currency: 'LKR', minorUnits: 0 }).success,
    false,
  );
  assert.equal(
    moneySchema.safeParse({ currency: 'LKR', minorUnits: '0', extra: true })
      .success,
    false,
  );
});

test('formats minor units without floating-point conversion', () => {
  assert.equal(formatMinorUnits('0'), '0.00');
  assert.equal(formatMinorUnits('5'), '0.05');
  assert.equal(formatMinorUnits('125000'), '1,250.00');
  assert.equal(formatMinorUnits('-2599'), '-25.99');
  assert.equal(
    formatMinorUnits('9007199254740993'),
    '90,071,992,547,409.93',
    'values beyond Number.MAX_SAFE_INTEGER must stay exact',
  );
  assert.equal(formatMoney({ currency: 'LKR', minorUnits: '0' }), 'LKR 0.00');
});

test('account references expose only masked digits', () => {
  assert.equal(
    publicAccountReferenceSchema.parse('AEGIS-4K7P-2R9M-8T3W'),
    'AEGIS-4K7P-2R9M-8T3W',
  );
  assert.equal(
    maskedAccountReferenceSchema.parse('AEGIS-****-****-8T3W'),
    'AEGIS-****-****-8T3W',
  );
  assert.equal(
    maskedAccountReferenceSchema.safeParse('AEGIS-4K7P-2R9M-8T3W').success,
    false,
  );
});

test('idempotency keys are bounded and use a safe alphabet', () => {
  assert.equal(
    idempotencyKeySchema.parse('acct-provision-0123456789'),
    'acct-provision-0123456789',
  );
  for (const invalid of ['short', 'a'.repeat(129), 'has space 0123456789']) {
    assert.equal(idempotencyKeySchema.safeParse(invalid).success, false);
  }
});

test('journal metadata rejects prototype pollution and oversized payloads', () => {
  assert.deepEqual(journalMetadataSchema.parse({ note: 'ok', count: 2 }), {
    note: 'ok',
    count: 2,
  });
  const polluted = JSON.parse('{"__proto__": "x"}') as Record<string, unknown>;
  assert.equal(journalMetadataSchema.safeParse(polluted).success, false);
  assert.equal(
    journalMetadataSchema.safeParse({ constructor: 'x' }).success,
    false,
  );
  assert.equal(
    journalMetadataSchema.safeParse({ nested: { deep: true } }).success,
    false,
  );
  const tooMany = Object.fromEntries(
    Array.from({ length: 17 }, (_, index) => [`key${index}`, 'value']),
  );
  assert.equal(journalMetadataSchema.safeParse(tooMany).success, false);
  assert.equal(
    journalMetadataSchema.safeParse({ big: 'x'.repeat(257) }).success,
    false,
  );
});

test('internal journal requests need at least two postings', () => {
  const base = {
    entryType: 'INTERNAL_TEST' as const,
    currency: 'LKR',
    idempotencyKey: 'journal-key-0123456789',
  };
  const valid = internalJournalRequestSchema.safeParse({
    ...base,
    postings: [
      { ledgerAccountId, direction: 'DEBIT', amountMinor: '100' },
      { ledgerAccountId: accountId, direction: 'CREDIT', amountMinor: '100' },
    ],
  });
  assert.equal(valid.success, true);

  assert.equal(
    internalJournalRequestSchema.safeParse({
      ...base,
      postings: [{ ledgerAccountId, direction: 'DEBIT', amountMinor: '100' }],
    }).success,
    false,
  );
  assert.equal(
    internalJournalRequestSchema.safeParse({
      ...base,
      postings: [
        { ledgerAccountId, direction: 'DEBIT', amountMinor: '0' },
        { ledgerAccountId: accountId, direction: 'CREDIT', amountMinor: '0' },
      ],
    }).success,
    false,
  );
});

test('customer account summary never carries an internal ledger identifier', () => {
  const summary = {
    id: accountId,
    maskedReference: 'AEGIS-****-****-8T3W',
    productType: 'TIER0_WALLET',
    status: 'ACTIVE',
    currency: 'LKR',
    createdAt: '2026-07-31T10:00:00.000Z',
  };
  assert.equal(customerAccountSummarySchema.safeParse(summary).success, true);
  assert.equal(
    customerAccountSummarySchema.safeParse({ ...summary, ledgerAccountId })
      .success,
    false,
  );
});

test('enumerations stay closed', () => {
  assert.equal(accountProductTypeSchema.safeParse('SAVINGS').success, false);
  assert.equal(postingDirectionSchema.safeParse('debit').success, false);
});

test('reconciliation results bound their issue list', () => {
  const base = {
    id: accountId,
    status: 'PASS' as const,
    startedAt: '2026-07-31T10:00:00.000Z',
    completedAt: '2026-07-31T10:00:01.000Z',
    checkedJournalEntries: 0,
    checkedPostings: 0,
    checkedLedgerAccounts: 2,
    checkedCustomerAccounts: 0,
    issueCount: 0,
    issues: [],
  };
  assert.equal(reconciliationResultSchema.safeParse(base).success, true);
  assert.equal(
    reconciliationResultSchema.safeParse({
      ...base,
      issues: Array.from({ length: 51 }, () => ({
        code: 'UNBALANCED_JOURNAL',
        severity: 'ERROR' as const,
      })),
    }).success,
    false,
  );
});
