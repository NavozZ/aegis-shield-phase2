import { z } from 'zod';
import { correlationIdSchema } from '../auth/v1.js';

/**
 * Monetary values never travel as JavaScript numbers. Every amount is an
 * integer count of minor units serialized as a decimal string so that values
 * beyond Number.MAX_SAFE_INTEGER survive JSON transport without rounding.
 */
export const MAX_MINOR_UNIT_DIGITS = 24 as const;

export const currencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/u, 'Currency must be a three-letter ISO 4217 code.');
export type CurrencyCode = z.infer<typeof currencyCodeSchema>;

/** Zero or a positive integer, for example "0" or "125000". */
export const minorUnitsSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,23})$/u, 'Minor units must be a whole number.');
export type MinorUnits = z.infer<typeof minorUnitsSchema>;

/** Strictly positive: posting amounts may never be zero or negative. */
export const positiveMinorUnitsSchema = z
  .string()
  .regex(/^[1-9]\d{0,23}$/u, 'Minor units must be greater than zero.');
export type PositiveMinorUnits = z.infer<typeof positiveMinorUnitsSchema>;

/** Balances may legitimately be negative for configured system accounts. */
export const signedMinorUnitsSchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d{0,23})$/u, 'Minor units must be a whole number.')
  .refine((value) => value !== '-0', 'Negative zero is not a valid amount.');
export type SignedMinorUnits = z.infer<typeof signedMinorUnitsSchema>;

export const moneySchema = z
  .object({
    currency: currencyCodeSchema,
    minorUnits: signedMinorUnitsSchema,
  })
  .strict();
export type Money = z.infer<typeof moneySchema>;

export const DEFAULT_CURRENCY = 'LKR' as const;

export const accountProductTypeSchema = z.enum(['TIER0_WALLET']);
export type AccountProductType = z.infer<typeof accountProductTypeSchema>;

export const accountStatusSchema = z.enum(['ACTIVE', 'FROZEN', 'CLOSED']);
export type AccountStatus = z.infer<typeof accountStatusSchema>;

export const ledgerAccountClassSchema = z.enum([
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE',
]);
export type LedgerAccountClass = z.infer<typeof ledgerAccountClassSchema>;

export const postingDirectionSchema = z.enum(['DEBIT', 'CREDIT']);
export type PostingDirection = z.infer<typeof postingDirectionSchema>;

export const journalEntryTypeSchema = z.enum([
  'ACCOUNT_ADJUSTMENT',
  'SETTLEMENT_FUNDING',
  'INTERNAL_TEST',
]);
export type JournalEntryType = z.infer<typeof journalEntryTypeSchema>;

/**
 * Idempotency keys are client-generated opaque strings. They are deliberately
 * distinct from correlation IDs so that a retried request keeps its key while
 * still receiving a fresh correlation ID.
 */
export const idempotencyKeySchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9._:-]{16,128}$/u,
    'Idempotency key must be 16 to 128 safe characters.',
  );
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;

export const publicAccountReferenceSchema = z
  .string()
  .regex(
    /^AEGIS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/u,
    'Public account reference format is invalid.',
  );
export type PublicAccountReference = z.infer<
  typeof publicAccountReferenceSchema
>;

export const maskedAccountReferenceSchema = z
  .string()
  .regex(
    /^AEGIS-\*{4}-\*{4}-[A-Z0-9]{4}$/u,
    'Masked account reference format is invalid.',
  );
export type MaskedAccountReference = z.infer<
  typeof maskedAccountReferenceSchema
>;

export const journalReferenceSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9._:-]{8,64}$/u,
    'Journal reference must be 8 to 64 safe characters.',
  );
export type JournalReference = z.infer<typeof journalReferenceSchema>;

export const journalDescriptionSchema = z.string().trim().min(1).max(256);

const UNSAFE_METADATA_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export const MAX_METADATA_ENTRIES = 16 as const;
export const MAX_METADATA_SERIALIZED_BYTES = 2_048 as const;

const journalMetadataRecordSchema = z
  .record(
    z
      .string()
      .trim()
      .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/u),
    z.union([z.string().max(256), z.number().int(), z.boolean()]),
  )
  .refine(
    (value) =>
      Object.keys(value).every((key) => !UNSAFE_METADATA_KEYS.has(key)),
    'Metadata contains an unsafe key.',
  )
  .refine(
    (value) => Object.keys(value).length <= MAX_METADATA_ENTRIES,
    `Metadata may not exceed ${MAX_METADATA_ENTRIES} entries.`,
  )
  .refine(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).length <=
      MAX_METADATA_SERIALIZED_BYTES,
    'Metadata is too large.',
  );

/**
 * Journal metadata is intentionally shallow. Nested objects, oversized payloads
 * and prototype-polluting keys are rejected before the value reaches the
 * database.
 *
 * Zod silently drops an own `__proto__` key rather than failing, which is safe
 * but indistinguishable from a clean payload. A ledger request that attempted
 * prototype pollution must be rejected and auditable, so raw keys are inspected
 * before the record transform runs.
 */
export const journalMetadataSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return;
    }
    for (const key of Object.keys(value)) {
      if (UNSAFE_METADATA_KEYS.has(key)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Metadata contains an unsafe key.',
        });
      }
    }
  })
  .pipe(journalMetadataRecordSchema);
export type JournalMetadata = z.infer<typeof journalMetadataSchema>;

export const customerAccountSummarySchema = z
  .object({
    id: z.uuid(),
    maskedReference: maskedAccountReferenceSchema,
    productType: accountProductTypeSchema,
    status: accountStatusSchema,
    currency: currencyCodeSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();
export type CustomerAccountSummary = z.infer<
  typeof customerAccountSummarySchema
>;

export const accountBalanceSchema = z
  .object({
    accountId: z.uuid(),
    balance: moneySchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type AccountBalance = z.infer<typeof accountBalanceSchema>;

export const customerAccountDetailSchema = customerAccountSummarySchema
  .extend({ balance: moneySchema })
  .strict();
export type CustomerAccountDetail = z.infer<typeof customerAccountDetailSchema>;

export const customerAccountListSchema = z
  .object({
    accounts: z.array(customerAccountSummarySchema).max(32),
  })
  .strict();
export type CustomerAccountList = z.infer<typeof customerAccountListSchema>;

/** The browser sends no body: the customer is derived from the session. */
export const provisionDefaultAccountRequestSchema = z.object({}).strict();
export type ProvisionDefaultAccountRequest = z.infer<
  typeof provisionDefaultAccountRequestSchema
>;

export const provisionDefaultAccountResultSchema = z
  .object({
    account: customerAccountDetailSchema,
    created: z.boolean(),
  })
  .strict();
export type ProvisionDefaultAccountResult = z.infer<
  typeof provisionDefaultAccountResultSchema
>;

/** Internal contract: the Gateway supplies the authenticated customer ID. */
export const internalProvisionDefaultAccountSchema = z
  .object({
    customerId: z.uuid(),
    productType: accountProductTypeSchema.default('TIER0_WALLET'),
    currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export type InternalProvisionDefaultAccountInput = z.infer<
  typeof internalProvisionDefaultAccountSchema
>;

export const journalPostingRequestSchema = z
  .object({
    ledgerAccountId: z.uuid(),
    direction: postingDirectionSchema,
    amountMinor: positiveMinorUnitsSchema,
  })
  .strict();
export type JournalPostingRequest = z.infer<typeof journalPostingRequestSchema>;

export const internalJournalRequestSchema = z
  .object({
    reference: journalReferenceSchema.optional(),
    entryType: journalEntryTypeSchema,
    currency: currencyCodeSchema,
    description: journalDescriptionSchema.optional(),
    effectiveAt: z.iso.datetime().optional(),
    idempotencyKey: idempotencyKeySchema,
    postings: z.array(journalPostingRequestSchema).min(2).max(32),
    metadata: journalMetadataSchema.optional(),
  })
  .strict();
export type InternalJournalRequest = z.infer<
  typeof internalJournalRequestSchema
>;

export const journalPostingResultSchema = z
  .object({
    id: z.uuid(),
    ledgerAccountId: z.uuid(),
    direction: postingDirectionSchema,
    amountMinor: positiveMinorUnitsSchema,
    sequence: z.number().int().min(0).max(31),
  })
  .strict();
export type JournalPostingResult = z.infer<typeof journalPostingResultSchema>;

export const journalResultSchema = z
  .object({
    id: z.uuid(),
    reference: journalReferenceSchema,
    entryType: journalEntryTypeSchema,
    currency: currencyCodeSchema,
    totalMinor: positiveMinorUnitsSchema,
    effectiveAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    postings: z.array(journalPostingResultSchema).min(2).max(32),
  })
  .strict();
export type JournalResult = z.infer<typeof journalResultSchema>;

export const reconciliationIssueSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
    severity: z.enum(['WARNING', 'ERROR']),
    safeIdentifier: z.string().max(64).optional(),
  })
  .strict();
export type ReconciliationIssue = z.infer<typeof reconciliationIssueSchema>;

export const MAX_RECONCILIATION_ISSUES = 50 as const;

export const reconciliationResultSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(['PASS', 'FAIL']),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
    checkedJournalEntries: z.number().int().min(0),
    checkedPostings: z.number().int().min(0),
    checkedLedgerAccounts: z.number().int().min(0),
    checkedCustomerAccounts: z.number().int().min(0),
    issueCount: z.number().int().min(0),
    issues: z.array(reconciliationIssueSchema).max(MAX_RECONCILIATION_ISSUES),
  })
  .strict();
export type ReconciliationResult = z.infer<typeof reconciliationResultSchema>;

export const LEDGER_ERROR_CODES = [
  'ACCOUNT_NOT_FOUND',
  'ACCOUNT_NOT_ACTIVE',
  'CURRENCY_MISMATCH',
  'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_IN_PROGRESS',
  'IDEMPOTENCY_KEY_REQUIRED',
  'INSUFFICIENT_FUNDS',
  'INVALID_REQUEST',
  'LEDGER_UNAVAILABLE',
  'UNBALANCED_JOURNAL',
] as const;

export const ledgerErrorCodeSchema = z.enum(LEDGER_ERROR_CODES);
export type LedgerErrorCode = z.infer<typeof ledgerErrorCodeSchema>;

export const ledgerErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
        message: z.string().min(1).max(256),
        correlationId: correlationIdSchema,
      })
      .strict(),
  })
  .strict();
export type LedgerErrorResponse = z.infer<typeof ledgerErrorResponseSchema>;

/**
 * Formats minor units for display without ever converting through a JavaScript
 * number. LKR uses two minor digits; the exponent is passed explicitly so that
 * future zero-decimal currencies remain correct.
 */
export function formatMinorUnits(
  minorUnits: string,
  fractionDigits = 2,
): string {
  const negative = minorUnits.startsWith('-');
  const digits = (negative ? minorUnits.slice(1) : minorUnits).padStart(
    fractionDigits + 1,
    '0',
  );
  const whole = digits.slice(0, digits.length - fractionDigits) || '0';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  const fraction =
    fractionDigits > 0
      ? `.${digits.slice(digits.length - fractionDigits)}`
      : '';
  return `${negative ? '-' : ''}${grouped}${fraction}`;
}

/** Renders a money value as, for example, "LKR 0.00". */
export function formatMoney(money: Money, fractionDigits = 2): string {
  return `${money.currency} ${formatMinorUnits(money.minorUnits, fractionDigits)}`;
}
