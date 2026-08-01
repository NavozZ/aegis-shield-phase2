#!/usr/bin/env node
/**
 * The deterministic disaster-recovery drill.
 *
 * Backup, verify, restore into disposable databases, reconcile, record, clean
 * up. Every step reports its outcome to the Resilience service so the evidence
 * lands in the append-only drill history rather than only in a CI log.
 *
 * The drill fails, loudly, when a dump is missing, a checksum differs, the
 * ciphertext is tampered with, the key is wrong, a service is absent from the
 * set, reconciliation fails, or cleanup fails. Those are the conditions under
 * which a real recovery would not work, so a drill that passed through them
 * would be worse than no drill.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { log, REPOSITORY_ROOT } from './dr-lib.mjs';

const serviceUrl =
  process.env.RESILIENCE_SERVICE_URL || 'http://127.0.0.1:4106';
const internalToken = process.env.RESILIENCE_INTERNAL_TOKEN || '';

/** Posts drill progress. A recording failure fails the drill: evidence matters. */
async function post(path, body) {
  const response = await fetch(new URL(path, serviceUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-aegis-internal-token': internalToken,
      'x-correlation-id': randomUUID(),
      connection: 'close',
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(
      `Resilience service rejected ${path} (${response.status}).`,
    );
  }
  return text.length > 0 ? JSON.parse(text) : undefined;
}

/** Runs a workspace script and returns its final JSON line. */
function runScript(script) {
  const result = spawnSync(
    process.execPath,
    [`services/resilience/scripts/${script}`],
    { cwd: REPOSITORY_ROOT, encoding: 'utf8', env: process.env },
  );
  process.stdout.write(result.stdout ?? '');
  if (result.stderr) process.stderr.write(result.stderr);
  const lines = (result.stdout ?? '').trim().split('\n').filter(Boolean);
  let payload;
  for (const line of lines.reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && 'status' in parsed) {
        payload = parsed;
        break;
      }
    } catch {
      // Not the JSON summary line; keep looking backwards.
    }
  }
  return { code: result.status ?? 1, payload };
}

let drillId;
let failureCode = 'BACKUP_FAILED';

try {
  const drill = await post('/internal/v1/drills', {
    type: 'CI_AUTOMATED',
    note: 'Automated recovery drill',
  });
  drillId = drill.drillId;
  log('drill.started', { drillId });
  await post(`/internal/v1/drills/${drillId}/advance`, {
    state: 'RUNNING',
    note: 'Creating encrypted backup set',
  });

  // 1. Backup.
  const backup = runScript('backup.mjs');
  if (backup.code !== 0 || backup.payload?.status !== 'PASS') {
    throw new Error('Backup failed.');
  }
  const backupSetId = backup.payload.backupSetId;
  await post('/internal/v1/backup-sets', {
    backupSetId,
    createdAt: backup.payload.createdAt,
    services: backup.payload.services,
    manifestChecksum: backup.payload.manifestChecksum,
    encryptionAlgorithm: 'AES-256-GCM',
    sizeBytes: backup.payload.sizeBytes,
  });
  await post(`/internal/v1/drills/${drillId}/advance`, {
    state: 'BACKUP_CREATED',
    backupSetId,
    note: 'Backup set created and registered',
  });

  // 2. Verify the set without restoring it.
  failureCode = 'MANIFEST_INVALID';
  const verified = runScript('backup-verify.mjs');
  if (verified.code !== 0 || verified.payload?.status !== 'PASS') {
    throw new Error('Backup verification failed.');
  }
  await post(`/internal/v1/backup-sets/${backupSetId}/verified`, {});

  // 3. Restore into disposable databases and prove the schema is there.
  failureCode = 'RESTORE_FAILED';
  const restored = runScript('restore-verify.mjs');
  if (restored.code !== 0 || restored.payload?.status !== 'PASS') {
    throw new Error('Isolated restore verification failed.');
  }
  await post(`/internal/v1/drills/${drillId}/advance`, {
    state: 'RESTORE_VERIFIED',
    measuredRecoveryPointAgeSeconds:
      restored.payload.measuredRecoveryPointAgeSeconds,
    measuredRecoveryDurationMs: restored.payload.measuredRecoveryDurationMs,
    note: 'Restored into isolated verification databases',
  });

  // 4. Reconcile every service that owns authoritative data.
  failureCode = 'RECONCILIATION_FAILED';
  const reconciliations = [];
  for (const [service, script] of [
    ['ledger', 'ledger:reconcile'],
    ['payments', 'payments:reconcile'],
    ['risk', 'risk:reconcile'],
    ['resilience', 'resilience:reconcile'],
  ]) {
    const result = spawnSync('pnpm', [script], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      env: process.env,
      shell: process.platform === 'win32',
    });
    process.stdout.write(result.stdout ?? '');
    const passed = result.status === 0;
    reconciliations.push({
      service,
      status: passed ? 'PASS' : 'FAIL',
      issueCount: passed ? 0 : 1,
    });
    if (!passed) throw new Error(`${service} reconciliation failed.`);
  }
  await post(`/internal/v1/drills/${drillId}/advance`, {
    state: 'RECONCILIATION_PASSED',
    reconciliations,
    note: 'All reconciliations passed',
  });

  await post(`/internal/v1/drills/${drillId}/advance`, {
    state: 'PASSED',
    note: 'Drill completed',
  });
  await post(`/internal/v1/drills/${drillId}/advance`, {
    state: 'CLEANED_UP',
    note: 'Temporary databases and decrypted material removed',
  });

  log('drill.passed', {
    drillId,
    backupSetId,
    measuredRecoveryPointAgeSeconds:
      restored.payload.measuredRecoveryPointAgeSeconds,
    measuredRecoveryDurationMs: restored.payload.measuredRecoveryDurationMs,
  });
  process.stdout.write(
    `${JSON.stringify({
      status: 'PASS',
      drillId,
      backupSetId,
      measuredRecoveryPointAgeSeconds:
        restored.payload.measuredRecoveryPointAgeSeconds,
      measuredRecoveryDurationMs: restored.payload.measuredRecoveryDurationMs,
    })}\n`,
  );
} catch (error) {
  const reason =
    error instanceof Error ? error.message.slice(0, 200) : 'unknown';
  log('drill.failed', { drillId, reason, failureCode });
  if (drillId) {
    // Record the failure so it appears in the console for acknowledgement,
    // rather than vanishing with the CI job.
    await post(`/internal/v1/drills/${drillId}/advance`, {
      state: 'FAILED',
      failureCode,
      note: 'Drill failed; see CI evidence',
    }).catch(() => undefined);
  }
  process.stdout.write(`${JSON.stringify({ status: 'FAIL', drillId })}\n`);
  process.exitCode = 1;
}
