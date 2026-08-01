import { randomUUID } from 'node:crypto';
import type { ResilienceConfig } from '../src/common/config/resilience.config';
import { PrismaService } from '../src/database/prisma.service';
import { DrillService } from '../src/drills/drill.service';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';

/*
 * Real PostgreSQL, real triggers, real constraints.
 *
 * The properties tested here cannot be tested against a mock, because they are
 * enforced by the database rather than by application code: drill history and
 * reconciliation results are append-only, and the fields that identify a backup
 * set's bytes are immutable. Those are the guarantees an auditor relies on when
 * reading recovery evidence after an incident, so they are verified against the
 * engine that actually enforces them.
 */

const runId = randomUUID().slice(0, 8);
const config = {
  host: '127.0.0.1',
  port: 4106,
  nodeEnvironment: 'test',
  databaseUrl: process.env.RESILIENCE_DATABASE_URL!,
  internalToken: 'integration-resilience-token',
  sourceTokens: {
    GATEWAY: 'integration-gateway-source',
    TOOLING: 'integration-tooling-source',
  },
  backupKeyConfigured: true,
  dependencies: [],
  httpTimeoutMs: 2000,
} as unknown as ResilienceConfig;

function setId(suffix: string) {
  return `backup:2026-08-01:${runId}${suffix}`;
}

describe('Resilience PostgreSQL integration', () => {
  let prisma: PrismaService;
  let drills: DrillService;
  let reconciliation: ReconciliationService;

  beforeAll(async () => {
    if (!config.databaseUrl) {
      throw new Error('RESILIENCE_DATABASE_URL is required for this suite.');
    }
    prisma = new PrismaService(config);
    await prisma.onModuleInit();
    drills = new DrillService(prisma);
    reconciliation = new ReconciliationService(prisma);
  });

  afterAll(async () => {
    // This suite deliberately does not delete its rows: the append-only triggers
    // it verifies would refuse, and a test that could clean up after itself
    // would be evidence the guarantee is missing. Every identifier is scoped to
    // `runId`, so repeated runs against a persistent database stay distinct.
    await prisma.onModuleDestroy();
  });

  it('records a backup set idempotently and marks it verified exactly once', async () => {
    const input = {
      backupSetId: setId('a'),
      createdAt: new Date(),
      services: ['identity', 'ledger', 'payments', 'risk', 'resilience'],
      manifestChecksum: 'a'.repeat(64),
      encryptionAlgorithm: 'AES-256-GCM',
      sizeBytes: 4096,
    };
    const first = await drills.recordBackupSet(input);
    const second = await drills.recordBackupSet(input);
    expect(second.backupSetId).toBe(first.backupSetId);
    expect(first.verified).toBe(false);

    const verified = await drills.markBackupVerified(input.backupSetId);
    expect(verified.verified).toBe(true);
    // The summary carries a checksum and a size — never a path, a key or a URL.
    expect(Object.keys(verified).sort()).toEqual([
      'backupSetId',
      'createdAt',
      'encryptionAlgorithm',
      'manifestChecksum',
      'services',
      'sizeBytes',
      'verified',
    ]);
  });

  it('refuses to change the fields that identify a backup set', async () => {
    const backupSetId = setId('b');
    await drills.recordBackupSet({
      backupSetId,
      createdAt: new Date(),
      services: ['identity', 'ledger', 'payments', 'risk', 'resilience'],
      manifestChecksum: 'b'.repeat(64),
      encryptionAlgorithm: 'AES-256-GCM',
      sizeBytes: 1024,
    });
    // Rewriting the checksum would let a substituted set claim to be the one
    // that was verified. The trigger, not the application, refuses it.
    await expect(
      prisma.client.$executeRawUnsafe(
        `UPDATE app.backup_sets SET manifest_checksum = $1 WHERE backup_set_id = $2`,
        'c'.repeat(64),
        backupSetId,
      ),
    ).rejects.toThrow();
  });

  it('walks a drill through the full lifecycle and records every step', async () => {
    const backupSetId = setId('c');
    await drills.recordBackupSet({
      backupSetId,
      createdAt: new Date(),
      services: ['identity', 'ledger', 'payments', 'risk', 'resilience'],
      manifestChecksum: 'c'.repeat(64),
      encryptionAlgorithm: 'AES-256-GCM',
      sizeBytes: 8192,
    });
    const created = await drills.createDrill({
      type: 'CI_AUTOMATED',
      requestedBy: `operator:integration:${runId}`,
      note: 'Lifecycle drill',
    });
    expect(created.state).toBe('PLANNED');

    await drills.advance({ drillId: created.drillId, state: 'RUNNING' });
    await drills.advance({
      drillId: created.drillId,
      state: 'BACKUP_CREATED',
      backupSetId,
    });
    await drills.advance({
      drillId: created.drillId,
      state: 'RESTORE_VERIFIED',
      measuredRecoveryPointAgeSeconds: 42,
      measuredRecoveryDurationMs: 1234,
    });
    await drills.advance({
      drillId: created.drillId,
      state: 'RECONCILIATION_PASSED',
      reconciliations: [
        { service: 'ledger', status: 'PASS', issueCount: 0 },
        { service: 'payments', status: 'PASS', issueCount: 0 },
        { service: 'risk', status: 'PASS', issueCount: 0 },
        { service: 'resilience', status: 'PASS', issueCount: 0 },
      ],
    });
    const passed = await drills.advance({
      drillId: created.drillId,
      state: 'PASSED',
    });

    expect(passed.state).toBe('PASSED');
    expect(passed.backupSetId).toBe(backupSetId);
    expect(passed.measuredRecoveryPointAgeSeconds).toBe(42);
    expect(passed.measuredRecoveryDurationMs).toBe(1234);
    expect(passed.reconciliations).toHaveLength(4);
    expect(passed.completedAt).not.toBeNull();

    const events = await drills.events(created.drillId);
    expect(events.map((event) => event.state)).toEqual([
      'PLANNED',
      'RUNNING',
      'BACKUP_CREATED',
      'RESTORE_VERIFIED',
      'RECONCILIATION_PASSED',
      'PASSED',
    ]);
  });

  it('refuses a transition that would misrepresent what was proven', async () => {
    const created = await drills.createDrill({
      type: 'MANUAL',
      requestedBy: `operator:integration:${runId}`,
    });
    // Straight from PLANNED to PASSED is the transition that matters: it would
    // record a drill that never restored anything as a successful recovery.
    await expect(
      drills.advance({ drillId: created.drillId, state: 'PASSED' }),
    ).rejects.toMatchObject({ status: 409 });

    await drills.advance({ drillId: created.drillId, state: 'RUNNING' });
    await expect(
      drills.advance({ drillId: created.drillId, state: 'RUNNING' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('keeps drill history append-only', async () => {
    const created = await drills.createDrill({
      type: 'MANUAL',
      requestedBy: `operator:integration:${runId}`,
      note: 'History drill',
    });
    await expect(
      prisma.client.$executeRawUnsafe(
        `UPDATE app.drill_events SET note = 'rewritten' WHERE state = 'PLANNED'`,
      ),
    ).rejects.toThrow();
    await expect(
      prisma.client.$executeRawUnsafe(
        `DELETE FROM app.drill_events WHERE state = 'PLANNED'`,
      ),
    ).rejects.toThrow();
    // The record survived both attempts.
    expect(await drills.events(created.drillId)).toHaveLength(1);
  });

  it('keeps reconciliation results append-only', async () => {
    const created = await drills.createDrill({
      type: 'MANUAL',
      requestedBy: `operator:integration:${runId}`,
    });
    await drills.advance({ drillId: created.drillId, state: 'RUNNING' });
    await drills.advance({ drillId: created.drillId, state: 'BACKUP_CREATED' });
    await drills.advance({
      drillId: created.drillId,
      state: 'RESTORE_VERIFIED',
    });
    await drills.advance({
      drillId: created.drillId,
      state: 'RECONCILIATION_PASSED',
      reconciliations: [{ service: 'ledger', status: 'FAIL', issueCount: 3 }],
    });
    await expect(
      prisma.client.$executeRawUnsafe(
        `UPDATE app.drill_reconciliations SET status = 'PASS' WHERE status = 'FAIL'`,
      ),
    ).rejects.toThrow();
  });

  it('acknowledges a failed drill once, and only a failed drill', async () => {
    const failed = await drills.createDrill({
      type: 'CI_AUTOMATED',
      requestedBy: `operator:integration:${runId}`,
    });
    await drills.advance({ drillId: failed.drillId, state: 'RUNNING' });
    await drills.advance({
      drillId: failed.drillId,
      state: 'FAILED',
      failureCode: 'RESTORE_FAILED',
      note: 'Restore exited non-zero',
    });

    const acknowledged = await drills.acknowledge(
      failed.drillId,
      `operator:integration:${runId}`,
      'Reviewed; verification host was out of disk.',
    );
    expect(acknowledged.acknowledgedBy).toBe(`operator:integration:${runId}`);
    expect(acknowledged.failureCode).toBe('RESTORE_FAILED');

    await expect(
      drills.acknowledge(
        failed.drillId,
        `operator:integration:${runId}`,
        'Second acknowledgement should be refused.',
      ),
    ).rejects.toMatchObject({ status: 409 });

    const planned = await drills.createDrill({
      type: 'MANUAL',
      requestedBy: `operator:integration:${runId}`,
    });
    await expect(
      drills.acknowledge(
        planned.drillId,
        `operator:integration:${runId}`,
        'Nothing has failed here.',
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('paginates history with a stable cursor and no overlap', async () => {
    for (let index = 0; index < 3; index += 1) {
      await drills.createDrill({
        type: 'MANUAL',
        requestedBy: `operator:integration:${runId}`,
        note: `Pagination drill ${String(index)}`,
      });
    }
    const first = await drills.history({ limit: 2 });
    expect(first.drills).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await drills.history({
      limit: 2,
      cursor: first.nextCursor!,
    });
    const overlap = second.drills.filter((drill) =>
      first.drills.some((item) => item.drillId === drill.drillId),
    );
    expect(overlap).toHaveLength(0);

    const filtered = await drills.history({ limit: 10, state: 'PLANNED' });
    expect(filtered.drills.every((drill) => drill.state === 'PLANNED')).toBe(
      true,
    );
  });

  it('reports an unacknowledged failure as a warning without failing evidence reconciliation', async () => {
    const failed = await drills.createDrill({
      type: 'CI_AUTOMATED',
      requestedBy: `operator:integration:${runId}`,
    });
    await drills.advance({ drillId: failed.drillId, state: 'RUNNING' });
    await drills.advance({
      drillId: failed.drillId,
      state: 'FAILED',
      failureCode: 'BACKUP_FAILED',
    });

    const result = await reconciliation.reconcile();
    expect(result.status).toBe('PASS');
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain('UNACKNOWLEDGED_FAILED_DRILL');
    // Warnings are reported; only a CRITICAL finding fails the run.
    expect(
      result.issues.every(
        (issue) => issue.severity !== 'CRITICAL' || issue.count === 0,
      ),
    ).toBe(true);
  });

  it('never returns a database URL, token or key in recovery evidence', async () => {
    const readiness = JSON.stringify(await drills.history({ limit: 20 }));
    for (const forbidden of [
      'postgresql://',
      'PGPASSWORD',
      config.internalToken,
      'DR_BACKUP_ENCRYPTION_KEY',
      '.dump',
    ]) {
      expect(readiness).not.toContain(forbidden);
    }
  });
});
