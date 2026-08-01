import { z } from 'zod';
import {
  currencyCodeSchema,
  maskedAccountReferenceSchema,
  moneySchema,
  positiveMinorUnitsSchema,
  publicAccountReferenceSchema,
} from '../accounts/v1.js';

const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
const isoDateTime = z.iso.datetime();

/**
 * Browser-entered LKR amounts stay strings until they are converted with
 * `lkrAmountToMinorUnits`. This deliberately avoids Number and floating point
 * rounding, including for values beyond Number.MAX_SAFE_INTEGER.
 */
export const humanLkrAmountSchema = z
  .string()
  .regex(
    /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u,
    'Amount must be a positive decimal.',
  )
  .refine((value) => value !== '0' && value !== '0.0' && value !== '0.00', {
    message: 'Amount must be greater than zero.',
  });
export type HumanLkrAmount = z.infer<typeof humanLkrAmountSchema>;

export function lkrAmountToMinorUnits(value: string): string {
  const amount = humanLkrAmountSchema.parse(value);
  const [whole, decimal = ''] = amount.split('.');
  const normalized = `${whole}${decimal.padEnd(2, '0')}`.replace(
    /^0+(?=\d)/u,
    '',
  );
  return normalized || '0';
}

export const transferStatusSchema = z.enum([
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'REQUIRES_REVIEW',
]);
export type TransferStatus = z.infer<typeof transferStatusSchema>;

export const transferDirectionSchema = z.enum(['SENT', 'RECEIVED']);
export type TransferDirection = z.infer<typeof transferDirectionSchema>;

export const transferFailureCodeSchema = z.enum([
  'INSUFFICIENT_FUNDS',
  'ACCOUNT_NOT_FOUND',
  'ACCOUNT_NOT_ACTIVE',
  'CURRENCY_MISMATCH',
  'SELF_TRANSFER',
  'LIMIT_EXCEEDED',
  'INTENT_EXPIRED',
  'AUTHORIZATION_FAILED',
  'IDEMPOTENCY_CONFLICT',
  'LEDGER_UNAVAILABLE',
  'PROCESSING_TIMEOUT',
  'INTERNAL_ERROR',
]);
export type TransferFailureCode = z.infer<typeof transferFailureCodeSchema>;

export const transferDisplayReferenceSchema = z
  .string()
  .regex(/^AEGIS-TRF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/u);

export const opaqueIntentTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43,128}$/u, 'Intent token is invalid.');

export const transferPolicySchema = z
  .object({
    currency: z.literal('LKR'),
    minimum: moneySchema,
    maximum: moneySchema,
    dailyOutgoingMaximum: moneySchema,
  })
  .strict();
export type TransferPolicy = z.infer<typeof transferPolicySchema>;

export const transferPreviewRequestSchema = z
  .object({
    sourceAccountId: z.uuid(),
    recipientReference: publicAccountReferenceSchema,
    amount: humanLkrAmountSchema,
  })
  .strict();
export type TransferPreviewRequest = z.infer<
  typeof transferPreviewRequestSchema
>;

export const internalTransferIntentRequestSchema = transferPreviewRequestSchema
  .extend({ senderCustomerId: z.uuid() })
  .strict();
export type InternalTransferIntentRequest = z.infer<
  typeof internalTransferIntentRequestSchema
>;

export const transferPreviewResponseSchema = z
  .object({
    intentToken: opaqueIntentTokenSchema,
    sourceMaskedReference: maskedAccountReferenceSchema,
    recipientMaskedReference: maskedAccountReferenceSchema,
    amount: moneySchema,
    sourceBalance: moneySchema,
    policy: transferPolicySchema,
    expiresAt: isoDateTime,
  })
  .strict();
export type TransferPreviewResponse = z.infer<
  typeof transferPreviewResponseSchema
>;

export const transferConfirmationRequestSchema = z
  .object({
    intentToken: opaqueIntentTokenSchema,
    pin: z.string().regex(/^\d{6}$/u),
  })
  .strict();
export type TransferConfirmationRequest = z.infer<
  typeof transferConfirmationRequestSchema
>;

export const internalTransferConfirmationSchema = z
  .object({
    senderCustomerId: z.uuid(),
    intentToken: opaqueIntentTokenSchema,
    idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/u),
  })
  .strict();
export type InternalTransferConfirmation = z.infer<
  typeof internalTransferConfirmationSchema
>;

export const transferSummarySchema = z
  .object({
    id: z.uuid(),
    displayReference: transferDisplayReferenceSchema,
    direction: transferDirectionSchema,
    status: transferStatusSchema,
    accountId: z.uuid(),
    counterpartyMaskedReference: maskedAccountReferenceSchema,
    amount: moneySchema,
    createdAt: isoDateTime,
    completedAt: isoDateTime.nullable(),
  })
  .strict();
export type TransferSummary = z.infer<typeof transferSummarySchema>;

export const transferDetailSchema = transferSummarySchema
  .extend({
    transactionId: z.uuid().nullable(),
    balanceAfter: moneySchema.nullable(),
    failureCode: transferFailureCodeSchema.nullable(),
    ownMaskedReference: maskedAccountReferenceSchema,
  })
  .strict();
export type TransferDetail = z.infer<typeof transferDetailSchema>;

export const transferConfirmationResponseSchema = transferDetailSchema;
export type TransferConfirmationResponse = z.infer<
  typeof transferConfirmationResponseSchema
>;

export const MAX_TRANSFER_PAGE_SIZE = 50 as const;
export const transferListQuerySchema = z
  .object({
    direction: transferDirectionSchema.optional(),
    status: transferStatusSchema.optional(),
    dateFrom: isoDateTime.optional(),
    dateTo: isoDateTime.optional(),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_TRANSFER_PAGE_SIZE)
      .default(20),
    cursor: z.string().min(1).max(1024).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo)
      ctx.addIssue({
        code: 'custom',
        message: 'dateFrom must not be after dateTo.',
      });
  });
export type TransferListQuery = z.infer<typeof transferListQuerySchema>;

export const transferListResponseSchema = z
  .object({
    transfers: z.array(transferSummarySchema).max(MAX_TRANSFER_PAGE_SIZE),
    nextCursor: z.string().min(1).max(1024).nullable(),
  })
  .strict();
export type TransferListResponse = z.infer<typeof transferListResponseSchema>;

export const pinStepUpRequestSchema = z
  .object({ pin: z.string().regex(/^\d{6}$/u) })
  .strict();
export const pinStepUpResponseSchema = z
  .object({ verified: z.literal(true) })
  .strict();

/** Trusted Payments-to-Ledger contract; never returned to a browser. */
export const internalTransferPreviewSchema = z
  .object({
    senderCustomerId: z.uuid(),
    sourceAccountId: z.uuid(),
    recipientReference: publicAccountReferenceSchema,
    amountMinor: positiveMinorUnitsSchema,
    currency: currencyCodeSchema,
  })
  .strict();
export type InternalTransferPreview = z.infer<
  typeof internalTransferPreviewSchema
>;

export const internalTransferPreviewResultSchema = z
  .object({
    sourceAccountId: z.uuid(),
    sourceMaskedReference: maskedAccountReferenceSchema,
    sourceBalance: moneySchema,
    recipientAccountId: z.uuid(),
    recipientCustomerId: z.uuid(),
    recipientMaskedReference: maskedAccountReferenceSchema,
    currency: currencyCodeSchema,
  })
  .strict();
export type InternalTransferPreviewResult = z.infer<
  typeof internalTransferPreviewResultSchema
>;

export const internalLedgerTransferCommandSchema = internalTransferPreviewSchema
  .extend({
    transferId: z.uuid(),
    transferReference: transferDisplayReferenceSchema,
    idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/u),
  })
  .strict();
export type InternalLedgerTransferCommand = z.infer<
  typeof internalLedgerTransferCommandSchema
>;

export const internalLedgerTransferResultSchema = z
  .object({
    journalId: z.uuid(),
    senderPostingId: z.uuid(),
    recipientPostingId: z.uuid(),
    senderAccountId: z.uuid(),
    recipientAccountId: z.uuid(),
    senderMaskedReference: maskedAccountReferenceSchema,
    recipientMaskedReference: maskedAccountReferenceSchema,
    senderBalanceAfter: moneySchema,
    recipientBalanceAfter: moneySchema,
    currency: currencyCodeSchema,
    amount: moneySchema,
    postedAt: isoDateTime,
  })
  .strict();
export type InternalLedgerTransferResult = z.infer<
  typeof internalLedgerTransferResultSchema
>;

export function rejectsUnsafeKeys(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.keys(value).some((key) => unsafeKeys.has(key))
  );
}
