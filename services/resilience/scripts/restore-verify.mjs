#!/usr/bin/env node
/**
 * Restores a backup set into disposable verification databases.
 *
 * The safety property that matters most: this never writes to an active service
 * database. Every restore target is a freshly created database with a generated
 * name, and the names of the live databases are checked against the targets
 * before a single byte is restored. The default path has no flag, no
 * environment variable and no argument that can redirect it onto a live
 * database — overwriting one is not a supported operation of this tool.
 *
 * Temporary databases and decrypted material are removed in `finally`, so a
 * failure mid-restore does not leave plaintext dumps or half-restored databases
 * behind.
 */
import { rmSync, writeFileSync } from 'node:fs';
import {
  BACKUP_SCOPE,
  adminConnection,
  backupRoot,
  connectionParts,
  decryptBackupFile,
  join,
  latestBackupDirectory,
  loadBackupKey,
  log,
  makeTempDirectory,
  psqlEnvironment,
  randomUUID,
  readFileSync,
  run,
  verifyBackupSet,
} from './dr-lib.mjs';

const requested = process.argv[2];
const root = backupRoot();

/** Live database names, so a target can never collide with one. */
function liveDatabaseNames() {
  const names = new Set();
  for (const { urlVariable } of BACKUP_SCOPE) {
    const raw = process.env[urlVariable];
    if (!raw) continue;
    names.add(connectionParts(raw, urlVariable).database);
  }
  return names;
}

const admin = adminConnection();
const adminEnvironment = psqlEnvironment(admin);
const workspace = makeTempDirectory('aegis-dr-restore-');
const created = [];
let status = 'FAIL';
let summary = {};

async function adminSql(sql) {
  await run(
    'psql',
    [
      '--host',
      admin.host,
      '--port',
      admin.port,
      '--username',
      admin.user,
      '--dbname',
      admin.database,
      '--set',
      'ON_ERROR_STOP=1',
      '--command',
      sql,
    ],
    { env: adminEnvironment },
  );
}

async function scalar(database, sql) {
  const output = await run(
    'psql',
    [
      '--host',
      admin.host,
      '--port',
      admin.port,
      '--username',
      admin.user,
      '--dbname',
      database,
      '--tuples-only',
      '--no-align',
      '--command',
      sql,
    ],
    { env: adminEnvironment, captureStdout: true },
  );
  return output.toString('utf8').trim();
}

try {
  const key = loadBackupKey();
  const directory = join(root, requested ?? latestBackupDirectory(root));

  // Checksums and authenticity first: a corrupted or wrong-key set is rejected
  // before any database is created.
  const { manifest, totalBytes } = verifyBackupSet(directory, key);
  log('restore.verified.manifest', { backupSetId: manifest.backupSetId });

  const live = liveDatabaseNames();
  const startedAt = Date.now();
  const checks = [];

  for (const entry of manifest.entries) {
    // A generated name per run, so concurrent drills cannot collide and a
    // target can never be an active database.
    const target = `aegis_verify_${entry.service}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    if (live.has(target)) {
      throw new Error('Refusing to restore over an active service database.');
    }
    if (!/^[a-z0-9_]{1,63}$/u.test(target)) {
      throw new Error('Generated verification database name is invalid.');
    }

    await adminSql(`CREATE DATABASE "${target}"`);
    created.push(target);

    const plaintextPath = join(workspace, `${entry.service}.dump`);
    writeFileSync(
      plaintextPath,
      decryptBackupFile(readFileSync(join(directory, entry.fileName)), key),
    );

    // `--no-owner` and `--no-acl` again on the way in: the verification role
    // owns everything it restores, and production grants are not replayed.
    await run(
      'pg_restore',
      [
        '--host',
        admin.host,
        '--port',
        admin.port,
        '--username',
        admin.user,
        '--dbname',
        target,
        '--no-owner',
        '--no-acl',
        '--exit-on-error',
        plaintextPath,
      ],
      { env: adminEnvironment },
    );
    // The decrypted dump is removed as soon as it has been consumed.
    rmSync(plaintextPath, { force: true });

    // A restored database must actually contain the schema, not merely exist.
    const tables = await scalar(
      target,
      "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'app'",
    );
    const tableCount = Number(tables);
    if (!Number.isSafeInteger(tableCount) || tableCount <= 0) {
      throw new Error(
        `Restored ${entry.service} database has no application tables.`,
      );
    }
    checks.push({ service: entry.service, tableCount });
    log('restore.service.verified', { service: entry.service, tableCount });
  }

  const durationMs = Date.now() - startedAt;
  const recoveryPointAgeSeconds = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(manifest.createdAt)) / 1000),
  );

  status = 'PASS';
  summary = {
    status,
    backupSetId: manifest.backupSetId,
    services: checks,
    sizeBytes: totalBytes,
    // Named for what they are. This is a prototype drill against disposable
    // local infrastructure, not a production RPO or RTO guarantee.
    measuredRecoveryPointAgeSeconds: recoveryPointAgeSeconds,
    measuredRecoveryDurationMs: durationMs,
  };
} catch (error) {
  summary = {
    status: 'FAIL',
    reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
  };
  log('restore.failed', summary);
  process.exitCode = 1;
} finally {
  // Cleanup runs whether the restore passed or failed. A cleanup failure is
  // itself reported rather than swallowed, because leftover verification
  // databases accumulate silently.
  for (const database of created) {
    try {
      await adminSql(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    } catch (error) {
      log('restore.cleanup.failed', {
        reason:
          error instanceof Error ? error.message.slice(0, 120) : 'unknown',
      });
      process.exitCode = 1;
    }
  }
  rmSync(workspace, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}
