import { z } from 'zod';

const isoDateTime = z.iso.datetime();
const opaqueIdentifier = z.string().regex(/^[A-Za-z0-9:_-]{8,128}$/u);
const safeAttributeValue = z.union([
  z.string().max(256),
  z.number().safe(),
  z.boolean(),
  z.null(),
]);

export const riskSourceSchema = z.enum([
  'GATEWAY',
  'IDENTITY',
  'PAYMENTS',
  'LEDGER',
  'INFRASTRUCTURE',
  'CHANNEL_ADAPTER',
]);
export const riskSeveritySchema = z.enum([
  'INFO',
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);
export const riskBandSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const riskDecisionSchema = z.enum([
  'ALLOW',
  'ALLOW_WITH_MONITORING',
  'REQUIRE_STEP_UP',
  'HOLD_FOR_REVIEW',
  'BLOCK',
  'QUARANTINE',
]);
export const controlTypeSchema = z.enum([
  'REQUIRE_STEP_UP',
  'TEMPORARY_BLOCK',
  'TRANSFER_HOLD',
  'RECIPIENT_BLOCK',
  'SESSION_REVOKE',
  'ACCOUNT_RESTRICT',
  'MANUAL_REVIEW',
  'QUARANTINE',
]);
export const controlScopeSchema = z.enum([
  'CUSTOMER',
  'SESSION',
  'DEVICE',
  'ACCOUNT',
  'RECIPIENT',
  'OPERATION',
  'SERVICE',
]);
export const controlStatusSchema = z.enum([
  'ACTIVE',
  'RELEASED',
  'EXPIRED',
  'OVERRIDDEN',
]);
export const incidentStatusSchema = z.enum([
  'OPEN',
  'INVESTIGATING',
  'CONTAINED',
  'RESOLVED',
  'FALSE_POSITIVE',
]);

export const securityEventTypeSchema = z.enum([
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'OTP_FAILURE',
  'PIN_FAILURE',
  'ACCOUNT_LOCK',
  'SESSION_CREATED',
  'SESSION_REVOKED',
  'CREDENTIAL_CHANGED',
  'DEVICE_CHANGED',
  'TRANSFER_PREVIEW',
  'TRANSFER_CONFIRMATION',
  'TRANSFER_FAILURE',
  'INSUFFICIENT_FUNDS',
  'IDEMPOTENCY_CONFLICT',
  'HIGH_VALUE_TRANSFER',
  'NEW_RECIPIENT',
  'EXPIRED_INTENT',
  'RECONCILIATION_ANOMALY',
  'RATE_LIMIT_VIOLATION',
  'CSRF_FAILURE',
  'MALFORMED_REQUEST',
  'FORBIDDEN_ROUTE',
  'SUSPICIOUS_REQUEST',
  'SERVICE_PROBE',
  'UNBALANCED_JOURNAL',
  'DUPLICATE_POSTING',
  'INTEGRITY_FAILURE',
  'INTERNAL_AUTH_FAILURE',
  'REPLAY_EVENT',
  'INVALID_SERVICE_TOKEN',
  'ROUTE_AUTH_ANOMALY',
  'TAMPER_SIGNAL',
]);

const allowedAttributes = new Set([
  'operation',
  'outcome',
  'amountMinor',
  'currency',
  'failureCode',
  'httpStatus',
  'route',
  'method',
  'stepUpVerified',
  'recipientIsNew',
  'regionCode',
  'previousRegionCode',
  'requestCount',
  'sourceVersion',
  'integrityCode',
]);
export const safeRiskAttributesSchema = z
  .record(z.string(), safeAttributeValue)
  .superRefine((attributes, context) => {
    for (const key of Object.keys(attributes)) {
      if (!allowedAttributes.has(key))
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Attribute is not allowlisted.',
        });
    }
  });

export const securityEventV1Schema = z
  .object({
    schemaVersion: z.literal('1.0'),
    eventId: z.uuid(),
    source: riskSourceSchema,
    sourceEventId: z.string().min(8).max(128),
    eventType: securityEventTypeSchema,
    severity: riskSeveritySchema,
    occurredAt: isoDateTime,
    subjectId: opaqueIdentifier.optional(),
    accountId: opaqueIdentifier.optional(),
    sessionId: opaqueIdentifier.optional(),
    deviceId: opaqueIdentifier.optional(),
    recipientId: opaqueIdentifier.optional(),
    correlationId: z.uuid(),
    attributes: safeRiskAttributesSchema.default({}),
  })
  .strict();
export type SecurityEventV1 = z.infer<typeof securityEventV1Schema>;

export const riskEvaluationRequestSchema = z
  .object({
    evaluationId: z.uuid(),
    operation: z.enum([
      'AUTHENTICATION',
      'TRANSFER_PREVIEW',
      'TRANSFER_CONFIRMATION',
      'SESSION_USE',
    ]),
    subjectId: opaqueIdentifier,
    sessionId: opaqueIdentifier.optional(),
    deviceId: opaqueIdentifier.optional(),
    accountId: opaqueIdentifier.optional(),
    recipientId: opaqueIdentifier.optional(),
    amountMinor: z
      .string()
      .regex(/^\d{1,20}$/u)
      .optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .optional(),
    stepUpVerified: z.boolean().default(false),
    occurredAt: isoDateTime,
    correlationId: z.uuid(),
  })
  .strict();
export type RiskEvaluationRequest = z.infer<typeof riskEvaluationRequestSchema>;

export const riskAssessmentSchema = z
  .object({
    assessmentId: z.uuid(),
    score: z.number().int().min(0).max(100),
    band: riskBandSchema,
    decision: riskDecisionSchema,
    triggeredRules: z.array(z.string().min(1).max(64)).max(32),
    reasonCodes: z.array(z.string().min(1).max(64)).max(32),
    controlRecommendation: controlTypeSchema.nullable(),
    expiresAt: isoDateTime,
    ruleSetVersion: z.string().min(1).max(32),
    publicExplanation: z.string().min(1).max(256),
  })
  .strict();
export type RiskAssessment = z.infer<typeof riskAssessmentSchema>;

export const controlCheckRequestSchema = z
  .object({
    operation: z.string().min(1).max(64),
    scopes: z
      .array(
        z.object({ type: controlScopeSchema, id: opaqueIdentifier }).strict(),
      )
      .min(1)
      .max(8),
    correlationId: z.uuid(),
  })
  .strict();
export const controlCheckResponseSchema = z
  .object({
    allowed: z.boolean(),
    decision: riskDecisionSchema,
    reasonCodes: z.array(z.string().min(1).max(64)).max(16),
    requiresStepUp: z.boolean(),
    expiresAt: isoDateTime.nullable(),
  })
  .strict();

export const applyControlRequestSchema = z
  .object({
    idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/u),
    type: controlTypeSchema,
    scopeType: controlScopeSchema,
    scopeId: opaqueIdentifier,
    reasonCode: z.string().regex(/^[A-Z0-9_]{3,64}$/u),
    expiresAt: isoDateTime,
    incidentId: z.uuid().optional(),
  })
  .strict();
export const releaseControlRequestSchema = z
  .object({
    reason: z.string().trim().min(8).max(500),
  })
  .strict();

export const operatorSessionSchema = z
  .object({
    operatorId: opaqueIdentifier,
    role: z.literal('SECURITY_OPERATOR'),
    csrfToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u),
    expiresAt: isoDateTime,
  })
  .strict();

export const riskOverviewSchema = z
  .object({
    eventsLast24Hours: z.number().int().nonnegative(),
    activeControls: z.number().int().nonnegative(),
    openIncidents: z.number().int().nonnegative(),
    highCriticalAssessments: z.number().int().nonnegative(),
    riskDistribution: z
      .object({
        LOW: z.number().int().nonnegative(),
        MEDIUM: z.number().int().nonnegative(),
        HIGH: z.number().int().nonnegative(),
        CRITICAL: z.number().int().nonnegative(),
      })
      .strict(),
    sourceHealth: z.array(
      z
        .object({
          source: riskSourceSchema,
          lastReceivedAt: isoDateTime,
          stale: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

export type ControlScope = z.infer<typeof controlScopeSchema>;
export type ControlType = z.infer<typeof controlTypeSchema>;
export type RiskDecision = z.infer<typeof riskDecisionSchema>;
