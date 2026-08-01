import { z } from 'zod';

/*
 * Operational resilience and disaster-recovery contracts, v1.
 *
 * These describe what an operator may see about backups, drills and recovery
 * readiness. Everything here crosses into a browser, so the schemas are the
 * privacy boundary for this domain and are `.strict()` throughout: a field that
 * is not declared is a parse failure rather than something rendered.
 *
 * Deliberately absent, and asserted absent by the tests: database URLs,
 * passwords, the backup encryption key, dump file paths, internal tokens, full
 * customer references and any raw row or transaction payload. A backup set is
 * identified by an opaque identifier and described by logical service names, not
 * by where its files live on disk.
 */

const isoDateTime = z.iso.datetime();

/** Opaque, operator-safe identifier. Never a path and never a customer value. */
const opaqueIdentifier = z
  .string()
  .regex(/^[A-Za-z0-9:_-]{8,128}$/u, 'must be an opaque identifier');

/** Logical service name. The tooling maps this to a database, never the reverse. */
export const resilienceServiceNameSchema = z.enum([
  'identity',
  'ledger',
  'payments',
  'risk',
  'resilience',
]);

/** Health of one component or of the platform as a whole. */
export const resilienceHealthStateSchema = z.enum([
  'HEALTHY',
  'DEGRADED',
  'UNAVAILABLE',
  'RECOVERING',
  'RECONCILING',
  'FAILED',
]);

/**
 * Drill lifecycle.
 *
 * The ordering is meaningful: a drill only reaches PASSED after a restore was
 * verified and reconciliation passed, and CLEANED_UP records that temporary
 * databases and decrypted material were removed.
 */
export const recoveryDrillStateSchema = z.enum([
  'PLANNED',
  'RUNNING',
  'BACKUP_CREATED',
  'RESTORE_VERIFIED',
  'RECONCILIATION_PASSED',
  'PASSED',
  'FAILED',
  'CLEANED_UP',
]);

export const recoveryDrillTypeSchema = z.enum([
  'SCHEDULED',
  'MANUAL',
  'CI_AUTOMATED',
]);

/** Coarse, non-identifying failure reason. Never an exception message. */
export const resilienceFailureCodeSchema = z.enum([
  'BACKUP_FAILED',
  'MANIFEST_INVALID',
  'CHECKSUM_MISMATCH',
  'DECRYPTION_FAILED',
  'INCOMPLETE_BACKUP_SET',
  'RESTORE_FAILED',
  'RECONCILIATION_FAILED',
  'CLEANUP_FAILED',
  'DEPENDENCY_UNAVAILABLE',
  'CONFIGURATION_INVALID',
]);

/** One dependency's reachability, with no connection detail attached. */
export const dependencyHealthSchema = z
  .object({
    name: z.string().min(2).max(64),
    kind: z.enum(['POSTGRES', 'REDIS', 'HTTP_SERVICE']),
    state: resilienceHealthStateSchema,
    /** Bounded, so a slow probe cannot be used to infer topology. */
    checkedAt: isoDateTime,
  })
  .strict();

export const serviceHealthSchema = z
  .object({
    service: z.string().min(2).max(64),
    state: resilienceHealthStateSchema,
    /** Absent when the service did not answer; never an exception message. */
    failureCode: resilienceFailureCodeSchema.nullable(),
    checkedAt: isoDateTime,
  })
  .strict();

/**
 * Summary of one encrypted backup set.
 *
 * `sizeBytes` is the total ciphertext size, which is operationally useful and
 * reveals nothing about content. There is no path field by design.
 */
export const backupSetSummarySchema = z
  .object({
    backupSetId: opaqueIdentifier,
    createdAt: isoDateTime,
    services: z.array(resilienceServiceNameSchema).min(1).max(16),
    /** Hex SHA-256 over the canonical manifest. Proves set integrity. */
    manifestChecksum: z.string().regex(/^[0-9a-f]{64}$/u),
    encryptionAlgorithm: z.literal('AES-256-GCM'),
    sizeBytes: z.number().int().nonnegative(),
    verified: z.boolean(),
  })
  .strict();

/** One file inside a manifest. Named by service, never by path. */
export const backupManifestEntrySchema = z
  .object({
    service: resilienceServiceNameSchema,
    /** File name only — no directory component, enforced by the pattern. */
    fileName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
    checksum: z.string().regex(/^[0-9a-f]{64}$/u),
    sizeBytes: z.number().int().nonnegative(),
    /** Migration the dump was taken at, so a restore mismatch is detectable. */
    migrationVersion: z.string().min(1).max(128).nullable(),
  })
  .strict();

export const backupManifestSchema = z
  .object({
    manifestVersion: z.literal('1.0'),
    backupSetId: opaqueIdentifier,
    createdAt: isoDateTime,
    encryptionAlgorithm: z.literal('AES-256-GCM'),
    /** Present so a reader knows the format, never the key itself. */
    keyDerivation: z.literal('raw-256-bit'),
    entries: z.array(backupManifestEntrySchema).min(1).max(16),
  })
  .strict()
  .superRefine((manifest, context) => {
    const services = manifest.entries.map((entry) => entry.service);
    if (new Set(services).size !== services.length) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'A service may appear at most once in a backup set.',
      });
    }
  });

export const reconciliationSummarySchema = z
  .object({
    service: resilienceServiceNameSchema,
    status: z.enum(['PASS', 'FAIL']),
    issueCount: z.number().int().nonnegative(),
    checkedAt: isoDateTime,
  })
  .strict();

/**
 * A recovery drill.
 *
 * The two measurements are named for what they are. This is a prototype drill
 * against disposable local infrastructure, so neither is a production RPO or
 * RTO guarantee, and the field names say so rather than relying on prose
 * elsewhere to qualify them.
 */
export const recoveryDrillSchema = z
  .object({
    drillId: opaqueIdentifier,
    type: recoveryDrillTypeSchema,
    state: recoveryDrillStateSchema,
    startedAt: isoDateTime,
    completedAt: isoDateTime.nullable(),
    /** Operator reference, not a customer identity. */
    requestedBy: opaqueIdentifier,
    backupSetId: opaqueIdentifier.nullable(),
    /** Age of the restored data at the moment of restore, in seconds. */
    measuredRecoveryPointAgeSeconds: z.number().int().nonnegative().nullable(),
    /** Wall-clock restore plus reconciliation, in milliseconds. */
    measuredRecoveryDurationMs: z.number().int().nonnegative().nullable(),
    reconciliations: z.array(reconciliationSummarySchema).max(16),
    failureCode: resilienceFailureCodeSchema.nullable(),
    acknowledgedAt: isoDateTime.nullable(),
    acknowledgedBy: opaqueIdentifier.nullable(),
  })
  .strict();

/** Append-only audit record of something that happened during a drill. */
export const drillAuditEventSchema = z
  .object({
    eventId: opaqueIdentifier,
    drillId: opaqueIdentifier,
    state: recoveryDrillStateSchema,
    occurredAt: isoDateTime,
    /** Short, safe, operator-readable. Never an exception or a path. */
    note: z.string().max(500).nullable(),
  })
  .strict();

export const operatorAcknowledgementRequestSchema = z
  .object({
    reason: z.string().trim().min(8).max(500),
  })
  .strict();

export const recordPlannedDrillRequestSchema = z
  .object({
    type: recoveryDrillTypeSchema,
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const drillHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: opaqueIdentifier.optional(),
    state: recoveryDrillStateSchema.optional(),
  })
  .strict();

export const drillHistoryResponseSchema = z
  .object({
    drills: z.array(recoveryDrillSchema).max(50),
    nextCursor: opaqueIdentifier.nullable(),
  })
  .strict();

/**
 * The operator console's whole view.
 *
 * One document so the page renders from a single validated payload rather than
 * stitching several partially-trusted responses together.
 */
export const recoveryReadinessSchema = z
  .object({
    platformState: resilienceHealthStateSchema,
    services: z.array(serviceHealthSchema).max(16),
    dependencies: z.array(dependencyHealthSchema).max(16),
    latestBackup: backupSetSummarySchema.nullable(),
    latestDrill: recoveryDrillSchema.nullable(),
    generatedAt: isoDateTime,
  })
  .strict();

export type ResilienceServiceName = z.infer<typeof resilienceServiceNameSchema>;
export type ResilienceHealthState = z.infer<typeof resilienceHealthStateSchema>;
export type RecoveryDrillState = z.infer<typeof recoveryDrillStateSchema>;
export type RecoveryDrillType = z.infer<typeof recoveryDrillTypeSchema>;
export type ResilienceFailureCode = z.infer<typeof resilienceFailureCodeSchema>;
export type DependencyHealth = z.infer<typeof dependencyHealthSchema>;
export type ServiceHealth = z.infer<typeof serviceHealthSchema>;
export type BackupSetSummary = z.infer<typeof backupSetSummarySchema>;
export type BackupManifestEntry = z.infer<typeof backupManifestEntrySchema>;
export type BackupManifest = z.infer<typeof backupManifestSchema>;
export type ReconciliationSummary = z.infer<typeof reconciliationSummarySchema>;
export type RecoveryDrill = z.infer<typeof recoveryDrillSchema>;
export type DrillAuditEvent = z.infer<typeof drillAuditEventSchema>;
export type DrillHistoryResponse = z.infer<typeof drillHistoryResponseSchema>;
export type RecoveryReadiness = z.infer<typeof recoveryReadinessSchema>;
