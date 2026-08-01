import { z } from 'zod';
import {
  currencyCodeSchema,
  maskedAccountReferenceSchema,
  moneySchema,
  positiveMinorUnitsSchema,
  publicAccountReferenceSchema,
} from '../accounts/v1.js';

const isoDateTime = z.iso.datetime();

// ─── QR Pay Contracts ───────────────────────────────────────────────

export const qrTypeSchema = z.enum(['STATIC', 'DYNAMIC']);
export type QrType = z.infer<typeof qrTypeSchema>;

export const qrStatusSchema = z.enum([
  'ACTIVE',
  'REDEEMED',
  'EXPIRED',
  'CANCELLED',
]);
export type QrStatus = z.infer<typeof qrStatusSchema>;

export const qrPaymentStatusSchema = z.enum([
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);
export type QrPaymentStatus = z.infer<typeof qrPaymentStatusSchema>;

export const QR_PROTOCOL_VERSION = 1 as const;

/**
 * Generate a receiving QR code. Browser sends sourceAccountId;
 * the backend derives the customer from the session.
 */
export const qrReceiveRequestSchema = z
  .object({
    sourceAccountId: z.uuid(),
  })
  .strict();
export type QrReceiveRequest = z.infer<typeof qrReceiveRequestSchema>;

/**
 * Generate a dynamic QR code with an exact amount.
 */
export const qrDynamicRequestSchema = z
  .object({
    sourceAccountId: z.uuid(),
    amount: positiveMinorUnitsSchema,
    currency: currencyCodeSchema.default('LKR'),
    purpose: z.string().max(64).optional(),
  })
  .strict();
export type QrDynamicRequest = z.infer<typeof qrDynamicRequestSchema>;

/** Internal QR issuance request (Gateway → Payments). */
export const internalQrIssueRequestSchema = z
  .object({
    customerId: z.uuid(),
    accountId: z.uuid(),
    type: qrTypeSchema,
    amountMinor: positiveMinorUnitsSchema.optional(),
    currency: currencyCodeSchema,
    purpose: z.string().max(64).optional(),
  })
  .strict();
export type InternalQrIssueRequest = z.infer<
  typeof internalQrIssueRequestSchema
>;

/** QR issuance response — contains the signed payload to encode as QR image. */
export const qrIssueResponseSchema = z
  .object({
    qrId: z.uuid(),
    payload: z.string().min(1).max(2048),
    type: qrTypeSchema,
    expiresAt: isoDateTime,
  })
  .strict();
export type QrIssueResponse = z.infer<typeof qrIssueResponseSchema>;

/** QR preview request — the scanned/pasted payload from the browser. */
export const qrPreviewRequestSchema = z
  .object({
    payload: z.string().min(1).max(2048),
    sourceAccountId: z.uuid(),
  })
  .strict();
export type QrPreviewRequest = z.infer<typeof qrPreviewRequestSchema>;

/** Internal QR preview request (Gateway → Payments). */
export const internalQrPreviewRequestSchema = z
  .object({
    payload: z.string().min(1).max(2048),
    senderCustomerId: z.uuid(),
    sourceAccountId: z.uuid(),
  })
  .strict();
export type InternalQrPreviewRequest = z.infer<
  typeof internalQrPreviewRequestSchema
>;

/** QR preview response — safe data for confirmation. */
export const qrPreviewResponseSchema = z
  .object({
    qrId: z.uuid(),
    recipientMaskedReference: maskedAccountReferenceSchema,
    amount: moneySchema.nullable(),
    purpose: z.string().max(64).nullable(),
    type: qrTypeSchema,
    expiresAt: isoDateTime,
    intentToken: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u),
  })
  .strict();
export type QrPreviewResponse = z.infer<typeof qrPreviewResponseSchema>;

/** QR confirmation request — from the browser after PIN step-up. */
export const qrConfirmRequestSchema = z
  .object({
    intentToken: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u),
    pin: z.string().regex(/^\d{6}$/u),
    amount: positiveMinorUnitsSchema.optional(),
  })
  .strict();
export type QrConfirmRequest = z.infer<typeof qrConfirmRequestSchema>;

/** Internal QR confirm request (Gateway → Payments). */
export const internalQrConfirmRequestSchema = z
  .object({
    senderCustomerId: z.uuid(),
    intentToken: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/u),
    amountMinor: positiveMinorUnitsSchema.optional(),
  })
  .strict();
export type InternalQrConfirmRequest = z.infer<
  typeof internalQrConfirmRequestSchema
>;

/** QR payment result. */
export const qrPaymentResultSchema = z
  .object({
    id: z.uuid(),
    displayReference: z.string(),
    status: qrPaymentStatusSchema,
    senderMaskedReference: maskedAccountReferenceSchema,
    recipientMaskedReference: maskedAccountReferenceSchema,
    amount: moneySchema,
    senderBalanceAfter: moneySchema.nullable(),
    createdAt: isoDateTime,
    completedAt: isoDateTime.nullable(),
  })
  .strict();
export type QrPaymentResult = z.infer<typeof qrPaymentResultSchema>;

/** QR receipt. */
export const qrReceiptSchema = qrPaymentResultSchema
  .extend({
    receiptReference: z.string(),
    purpose: z.string().max(64).nullable(),
  })
  .strict();
export type QrReceipt = z.infer<typeof qrReceiptSchema>;

// ─── USSD Contracts ─────────────────────────────────────────────────

export const ussdLanguageSchema = z.enum(['EN', 'SI', 'TA']);
export type UssdLanguage = z.infer<typeof ussdLanguageSchema>;

export const ussdMenuStateSchema = z.enum([
  'WELCOME',
  'AUTH',
  'AUTH_PIN',
  'MAIN_MENU',
  'BALANCE',
  'HISTORY',
  'SEND_MONEY_RECIPIENT',
  'SEND_MONEY_AMOUNT',
  'SEND_MONEY_CONFIRM',
  'SEND_MONEY_PIN',
  'SEND_MONEY_RESULT',
  'CANCELLED',
  'TIMEOUT',
  'ERROR',
]);
export type UssdMenuState = z.infer<typeof ussdMenuStateSchema>;

/** Provider webhook request (from telecom). */
export const ussdProviderRequestSchema = z
  .object({
    sessionId: z.string().min(1).max(128),
    msisdn: z.string().regex(/^\+?[1-9]\d{6,14}$/u),
    input: z.string().max(160),
    type: z.enum(['initiation', 'response']),
    timestamp: isoDateTime,
    nonce: z.string().min(8).max(64),
  })
  .strict();
export type UssdProviderRequest = z.infer<typeof ussdProviderRequestSchema>;

/** Provider webhook response (to telecom). */
export const ussdProviderResponseSchema = z
  .object({
    sessionId: z.string().min(1).max(128),
    message: z.string().max(182),
    type: z.enum(['response', 'release']),
  })
  .strict();
export type UssdProviderResponse = z.infer<typeof ussdProviderResponseSchema>;

/** USSD simulator request (browser → gateway → payments). */
export const ussdSimulatorRequestSchema = z
  .object({
    sessionId: z.string().min(1).max(128).optional(),
    input: z.string().max(160),
    language: ussdLanguageSchema.default('EN'),
  })
  .strict();
export type UssdSimulatorRequest = z.infer<typeof ussdSimulatorRequestSchema>;

/** USSD simulator response (to browser). */
export const ussdSimulatorResponseSchema = z
  .object({
    sessionId: z.string().min(1).max(128),
    message: z.string().max(182),
    ended: z.boolean(),
    simulated: z.literal(true),
  })
  .strict();
export type UssdSimulatorResponse = z.infer<typeof ussdSimulatorResponseSchema>;

// ─── Agent Cash Contracts ───────────────────────────────────────────

export const agentStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const agentCashOperationTypeSchema = z.enum([
  'AGENT_CASH_IN',
  'AGENT_CASH_OUT',
]);
export type AgentCashOperationType = z.infer<
  typeof agentCashOperationTypeSchema
>;

export const agentCashOperationStatusSchema = z.enum([
  'PENDING_CONFIRMATION',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export type AgentCashOperationStatus = z.infer<
  typeof agentCashOperationStatusSchema
>;

/** Public agent reference format. */
export const agentPublicReferenceSchema = z
  .string()
  .regex(/^AEGIS-AGT-[A-Z0-9]{4}-[A-Z0-9]{4}$/u);
export type AgentPublicReference = z.infer<typeof agentPublicReferenceSchema>;

/** Agent sign-in request. */
export const agentAuthRequestSchema = z
  .object({
    agentReference: agentPublicReferenceSchema,
    pin: z.string().regex(/^\d{6}$/u),
  })
  .strict();
export type AgentAuthRequest = z.infer<typeof agentAuthRequestSchema>;

/** Agent session response. */
export const agentSessionResponseSchema = z
  .object({
    agentId: z.uuid(),
    agentReference: agentPublicReferenceSchema,
    status: agentStatusSchema,
    sessionToken: z.string().min(32).max(256),
    expiresAt: isoDateTime,
  })
  .strict();
export type AgentSessionResponse = z.infer<typeof agentSessionResponseSchema>;

/** Agent limits response. */
export const agentLimitsResponseSchema = z
  .object({
    agentReference: agentPublicReferenceSchema,
    currency: currencyCodeSchema,
    minTransactionMinor: positiveMinorUnitsSchema,
    maxTransactionMinor: positiveMinorUnitsSchema,
    dailyCashInLimitMinor: positiveMinorUnitsSchema,
    dailyCashOutLimitMinor: positiveMinorUnitsSchema,
    dailyCashInUsedMinor: z.string(),
    dailyCashOutUsedMinor: z.string(),
    floatBalanceMinor: z.string(),
    floatLimitMinor: positiveMinorUnitsSchema,
  })
  .strict();
export type AgentLimitsResponse = z.infer<typeof agentLimitsResponseSchema>;

/** Agent cash-in preview request. */
export const agentCashInPreviewRequestSchema = z
  .object({
    customerReference: publicAccountReferenceSchema,
    amountMinor: positiveMinorUnitsSchema,
    currency: currencyCodeSchema.default('LKR'),
  })
  .strict();
export type AgentCashInPreviewRequest = z.infer<
  typeof agentCashInPreviewRequestSchema
>;

/** Agent cash-out preview request. */
export const agentCashOutPreviewRequestSchema = z
  .object({
    customerReference: publicAccountReferenceSchema,
    amountMinor: positiveMinorUnitsSchema,
    currency: currencyCodeSchema.default('LKR'),
  })
  .strict();
export type AgentCashOutPreviewRequest = z.infer<
  typeof agentCashOutPreviewRequestSchema
>;

/** Agent cash preview response. */
export const agentCashPreviewResponseSchema = z
  .object({
    operationId: z.uuid(),
    operationType: agentCashOperationTypeSchema,
    customerMaskedReference: maskedAccountReferenceSchema,
    agentReference: agentPublicReferenceSchema,
    amount: moneySchema,
    intentToken: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u),
    expiresAt: isoDateTime,
  })
  .strict();
export type AgentCashPreviewResponse = z.infer<
  typeof agentCashPreviewResponseSchema
>;

/** Agent cash confirm request. */
export const agentCashConfirmRequestSchema = z
  .object({
    intentToken: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u),
    customerPin: z
      .string()
      .regex(/^\d{6}$/u)
      .optional(),
  })
  .strict();
export type AgentCashConfirmRequest = z.infer<
  typeof agentCashConfirmRequestSchema
>;

/** Internal agent cash confirm request (Gateway → Payments). */
export const internalAgentCashConfirmRequestSchema = z
  .object({
    agentId: z.uuid(),
    intentToken: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/u),
  })
  .strict();
export type InternalAgentCashConfirmRequest = z.infer<
  typeof internalAgentCashConfirmRequestSchema
>;

/** Agent cash operation result. */
export const agentCashResultSchema = z
  .object({
    id: z.uuid(),
    displayReference: z.string(),
    operationType: agentCashOperationTypeSchema,
    status: agentCashOperationStatusSchema,
    customerMaskedReference: maskedAccountReferenceSchema,
    agentReference: agentPublicReferenceSchema,
    amount: moneySchema,
    createdAt: isoDateTime,
    completedAt: isoDateTime.nullable(),
  })
  .strict();
export type AgentCashResult = z.infer<typeof agentCashResultSchema>;

/** Agent cash receipt. */
export const agentCashReceiptSchema = agentCashResultSchema
  .extend({
    receiptReference: z.string(),
    agentFloatAfter: moneySchema.nullable(),
  })
  .strict();
export type AgentCashReceipt = z.infer<typeof agentCashReceiptSchema>;

// ─── Internal Ledger Channel Contracts ──────────────────────────────

/** Internal QR payment ledger command (Payments → Ledger). */
export const internalQrPaymentCommandSchema = z
  .object({
    paymentId: z.uuid(),
    paymentReference: z
      .string()
      .regex(/^AEGIS-QRP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/u),
    senderCustomerId: z.uuid(),
    sourceAccountId: z.uuid(),
    recipientReference: publicAccountReferenceSchema,
    amountMinor: positiveMinorUnitsSchema,
    currency: currencyCodeSchema,
    idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/u),
  })
  .strict();
export type InternalQrPaymentCommand = z.infer<
  typeof internalQrPaymentCommandSchema
>;

/** Internal agent cash-in ledger command (Payments → Ledger). */
export const internalAgentCashInCommandSchema = z
  .object({
    operationId: z.uuid(),
    operationReference: z.string(),
    agentAccountId: z.uuid(),
    customerReference: publicAccountReferenceSchema,
    amountMinor: positiveMinorUnitsSchema,
    currency: currencyCodeSchema,
    idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/u),
  })
  .strict();
export type InternalAgentCashInCommand = z.infer<
  typeof internalAgentCashInCommandSchema
>;

/** Internal agent cash-out ledger command (Payments → Ledger). */
export const internalAgentCashOutCommandSchema = z
  .object({
    operationId: z.uuid(),
    operationReference: z.string(),
    agentAccountId: z.uuid(),
    customerReference: publicAccountReferenceSchema,
    amountMinor: positiveMinorUnitsSchema,
    currency: currencyCodeSchema,
    idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/u),
  })
  .strict();
export type InternalAgentCashOutCommand = z.infer<
  typeof internalAgentCashOutCommandSchema
>;

/** Internal ledger channel operation result (Ledger → Payments). */
export const internalChannelLedgerResultSchema = z
  .object({
    journalId: z.uuid(),
    postings: z.array(
      z.object({
        id: z.uuid(),
        ledgerAccountId: z.uuid(),
        direction: z.enum(['DEBIT', 'CREDIT']),
        amountMinor: positiveMinorUnitsSchema,
      }),
    ),
    senderBalanceAfter: moneySchema.nullable(),
    recipientBalanceAfter: moneySchema.nullable(),
    currency: currencyCodeSchema,
    amount: moneySchema,
    postedAt: isoDateTime,
  })
  .strict();
export type InternalChannelLedgerResult = z.infer<
  typeof internalChannelLedgerResultSchema
>;
