import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backupManifestSchema,
  backupSetSummarySchema,
  drillHistoryQuerySchema,
  drillHistoryResponseSchema,
  operatorAcknowledgementRequestSchema,
  recordPlannedDrillRequestSchema,
  recoveryDrillSchema,
  recoveryReadinessSchema,
} from './v1.js';

const NOW = '2026-08-01T12:00:00.000Z';

const drill = {
  drillId: 'drill:2026-08-01:aaaaaaaa',
  type: 'CI_AUTOMATED' as const,
  state: 'PASSED' as const,
  startedAt: NOW,
  completedAt: NOW,
  requestedBy: 'operator:ci-automation',
  backupSetId: 'backup:2026-08-01:bbbbbbbb',
  measuredRecoveryPointAgeSeconds: 42,
  measuredRecoveryDurationMs: 8_100,
  reconciliations: [
    {
      service: 'ledger' as const,
      status: 'PASS' as const,
      issueCount: 0,
      checkedAt: NOW,
    },
  ],
  failureCode: null,
  acknowledgedAt: null,
  acknowledgedBy: null,
};

const manifest = {
  manifestVersion: '1.0' as const,
  backupSetId: 'backup:2026-08-01:bbbbbbbb',
  createdAt: NOW,
  encryptionAlgorithm: 'AES-256-GCM' as const,
  keyDerivation: 'raw-256-bit' as const,
  entries: [
    {
      service: 'ledger' as const,
      fileName: 'ledger.dump.enc',
      checksum: 'a'.repeat(64),
      sizeBytes: 1024,
      migrationVersion: '20260801120000_init',
    },
  ],
};

test('a complete drill and manifest are accepted', () => {
  assert.equal(recoveryDrillSchema.safeParse(drill).success, true);
  assert.equal(backupManifestSchema.safeParse(manifest).success, true);
});

test('every drill state and failure code is closed', () => {
  for (const state of [
    'PLANNED',
    'RUNNING',
    'BACKUP_CREATED',
    'RESTORE_VERIFIED',
    'RECONCILIATION_PASSED',
    'PASSED',
    'FAILED',
    'CLEANED_UP',
  ]) {
    assert.equal(
      recoveryDrillSchema.safeParse({ ...drill, state }).success,
      true,
      state,
    );
  }
  assert.equal(
    recoveryDrillSchema.safeParse({ ...drill, state: 'MOSTLY_FINE' }).success,
    false,
  );
  assert.equal(
    recoveryDrillSchema.safeParse({ ...drill, failureCode: 'IT_BROKE' })
      .success,
    false,
  );
});

test('timestamps must be ISO date-times', () => {
  for (const bad of ['2026-08-01', 'yesterday', '', '1754049600']) {
    assert.equal(
      recoveryDrillSchema.safeParse({ ...drill, startedAt: bad }).success,
      false,
      bad,
    );
  }
});

test('measurements are non-negative integers or explicitly absent', () => {
  assert.equal(
    recoveryDrillSchema.safeParse({
      ...drill,
      measuredRecoveryPointAgeSeconds: null,
    }).success,
    true,
  );
  for (const bad of [-1, 1.5, '42']) {
    assert.equal(
      recoveryDrillSchema.safeParse({
        ...drill,
        measuredRecoveryDurationMs: bad,
      }).success,
      false,
      String(bad),
    );
  }
});

test('sensitive fields are rejected rather than carried', () => {
  // The schemas are the privacy boundary for this domain: anything not declared
  // must fail to parse, not render.
  for (const extra of [
    { databaseUrl: 'postgresql://u:p@h/db' },
    { encryptionKey: 'a'.repeat(43) },
    { dumpPath: '/var/backups/ledger.dump' },
    { internalToken: 'ci-only-token' },
    { customerId: 'cus_1234' },
    { rows: [{ amountMinor: '100' }] },
  ]) {
    assert.equal(
      recoveryDrillSchema.safeParse({ ...drill, ...extra }).success,
      false,
      JSON.stringify(extra),
    );
    assert.equal(
      backupSetSummarySchema.safeParse({
        backupSetId: 'backup:2026-08-01:bbbbbbbb',
        createdAt: NOW,
        services: ['ledger'],
        manifestChecksum: 'b'.repeat(64),
        encryptionAlgorithm: 'AES-256-GCM',
        sizeBytes: 10,
        verified: true,
        ...extra,
      }).success,
      false,
      JSON.stringify(extra),
    );
  }
});

test('a manifest entry names a file, never a path', () => {
  for (const fileName of [
    '../ledger.dump.enc',
    '/etc/passwd',
    'nested/ledger.dump.enc',
    '..',
    '',
  ]) {
    assert.equal(
      backupManifestSchema.safeParse({
        ...manifest,
        entries: [{ ...manifest.entries[0], fileName }],
      }).success,
      false,
      fileName,
    );
  }
});

test('a service may appear at most once in a backup set', () => {
  assert.equal(
    backupManifestSchema.safeParse({
      ...manifest,
      entries: [manifest.entries[0], manifest.entries[0]],
    }).success,
    false,
  );
});

test('an unsupported manifest version is refused', () => {
  assert.equal(
    backupManifestSchema.safeParse({ ...manifest, manifestVersion: '2.0' })
      .success,
    false,
  );
  // A future algorithm must be a deliberate contract change, not a value a
  // manifest can simply assert.
  assert.equal(
    backupManifestSchema.safeParse({
      ...manifest,
      encryptionAlgorithm: 'AES-128-CBC',
    }).success,
    false,
  );
});

test('checksums must be full SHA-256 hex', () => {
  for (const bad of ['a'.repeat(63), 'A'.repeat(64), 'z'.repeat(64), '']) {
    assert.equal(
      backupManifestSchema.safeParse({
        ...manifest,
        entries: [{ ...manifest.entries[0], checksum: bad }],
      }).success,
      false,
      bad,
    );
  }
});

test('drill history pagination is bounded and defaulted', () => {
  assert.equal(drillHistoryQuerySchema.parse({}).limit, 20);
  assert.equal(drillHistoryQuerySchema.safeParse({ limit: 51 }).success, false);
  assert.equal(drillHistoryQuerySchema.safeParse({ limit: 0 }).success, false);
  assert.equal(
    drillHistoryQuerySchema.safeParse({ limit: 10, extra: true }).success,
    false,
  );
  assert.equal(
    drillHistoryResponseSchema.safeParse({
      drills: Array.from({ length: 51 }, () => drill),
      nextCursor: null,
    }).success,
    false,
  );
});

test('operator input is trimmed and bounded', () => {
  assert.equal(
    operatorAcknowledgementRequestSchema.safeParse({ reason: 'short' }).success,
    false,
  );
  assert.equal(
    operatorAcknowledgementRequestSchema.safeParse({
      reason: 'x'.repeat(501),
    }).success,
    false,
  );
  assert.equal(
    operatorAcknowledgementRequestSchema.parse({
      reason: '  verified after review  ',
    }).reason,
    'verified after review',
  );
  assert.equal(
    recordPlannedDrillRequestSchema.safeParse({ type: 'MANUAL' }).success,
    true,
  );
  assert.equal(
    recordPlannedDrillRequestSchema.safeParse({ type: 'WHENEVER' }).success,
    false,
  );
});

test('readiness carries only safe component state', () => {
  const readiness = {
    platformState: 'HEALTHY' as const,
    services: [
      {
        service: 'ledger',
        state: 'HEALTHY' as const,
        failureCode: null,
        checkedAt: NOW,
      },
    ],
    dependencies: [
      {
        name: 'postgres',
        kind: 'POSTGRES' as const,
        state: 'HEALTHY' as const,
        checkedAt: NOW,
      },
    ],
    latestBackup: null,
    latestDrill: null,
    generatedAt: NOW,
  };
  assert.equal(recoveryReadinessSchema.safeParse(readiness).success, true);
  // A dependency must not be able to describe how to reach it.
  assert.equal(
    recoveryReadinessSchema.safeParse({
      ...readiness,
      dependencies: [
        { ...readiness.dependencies[0], url: 'postgres://h:5432' },
      ],
    }).success,
    false,
  );
});
