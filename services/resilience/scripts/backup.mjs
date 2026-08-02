#!/usr/bin/env node
/**
 * Creates one encrypted backup set.
 *
 * A set is published atomically: everything is written to a temporary directory
 * and renamed into place only once every dump has been taken, encrypted,
 * checksummed and listed. A failure removes the partial directory, so a reader
 * never sees a half-written set that would restore an inconsistent platform.
 */
import {
  BACKUP_SCOPE,
  adminConnection,
  backupRoot,
  canonicalManifestBytes,
  connectionParts,
  encryptBackupFile,
  join,
  loadBackupKey,
  log,
  mkdirSync,
  psqlEnvironment,
  randomUUID,
  readFileSync,
  renameSync,
  rmSync,
  run,
  sha256Hex,
  makeTempDirectory,
  writeFileSync,
} from './dr-lib.mjs';
import { backupManifestSchema } from '@aegis/contracts';

const key = loadBackupKey();
const createdAt = new Date();
const backupSetId = `backup:${createdAt.toISOString().slice(0, 10)}:${randomUUID().slice(0, 8)}`;
const root = backupRoot();
mkdirSync(root, { recursive: true });

const staging = makeTempDirectory('aegis-dr-backup-');
const directoryName = backupSetId.replaceAll(':', '_');
const final = join(root, directoryName);

/** Reads the applied migration version, so a restore mismatch is detectable. */
async function migrationVersion(parts) {
  try {
    const output = await run(
      'psql',
      [
        '--host',
        parts.host,
        '--port',
        parts.port,
        '--username',
        parts.user,
        '--dbname',
        parts.database,
        '--tuples-only',
        '--no-align',
        '--command',
        'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1',
      ],
      { env: psqlEnvironment(parts), captureStdout: true },
    );
    const value = output.toString('utf8').trim();
    return value.length > 0 ? value.slice(0, 128) : null;
  } catch {
    // A missing migrations table is not a backup failure; it is recorded as
    // unknown so the manifest stays honest.
    return null;
  }
}

let published = false;
try {
  log('backup.started', { backupSetId, services: BACKUP_SCOPE.length });
  const entries = [];

  for (const { service, urlVariable } of BACKUP_SCOPE) {
    const parts = connectionParts(process.env[urlVariable], urlVariable);
    const dumpPath = join(staging, `${service}.dump`);

    // Custom format, and deliberately without owner or ACL statements: a
    // verification restore runs as a different role into a disposable database,
    // and replaying production grants there would fail or, worse, succeed.
    await run(
      'pg_dump',
      [
        '--host',
        parts.host,
        '--port',
        parts.port,
        '--username',
        parts.user,
        '--dbname',
        parts.database,
        '--format',
        'custom',
        '--no-owner',
        '--no-acl',
        '--file',
        dumpPath,
      ],
      { env: psqlEnvironment(parts) },
    );

    const plaintext = readFileSync(dumpPath);
    const encrypted = encryptBackupFile(plaintext, key);
    const fileName = `${service}.dump.enc`;
    writeFileSync(join(staging, fileName), encrypted);
    // The plaintext dump never survives the loop.
    rmSync(dumpPath, { force: true });

    entries.push({
      service,
      fileName,
      checksum: sha256Hex(encrypted),
      sizeBytes: encrypted.length,
      migrationVersion: await migrationVersion(parts),
    });
    log('backup.service.captured', { service, sizeBytes: encrypted.length });
  }

  const manifest = backupManifestSchema.parse({
    manifestVersion: '1.0',
    backupSetId,
    createdAt: createdAt.toISOString(),
    encryptionAlgorithm: 'AES-256-GCM',
    keyDerivation: 'raw-256-bit',
    entries,
  });
  writeFileSync(
    join(staging, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  // Atomic publication: the set becomes visible only when it is complete.
  renameSync(staging, final);
  published = true;

  const manifestChecksum = sha256Hex(canonicalManifestBytes(manifest));
  const totalBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  log('backup.completed', {
    backupSetId,
    manifestChecksum,
    sizeBytes: totalBytes,
  });
  // The exact next commands, with this set named explicitly. Every later tool
  // refuses to guess a set, so the operator is handed the identifier rather than
  // left to find it.
  process.stderr.write(
    [
      '',
      `Backup set created: ${backupSetId}`,
      '',
      'Next steps, in order:',
      `  pnpm dr:backup:verify -- --set ${backupSetId}`,
      `  pnpm dr:backup:verify:negative -- --set ${backupSetId}`,
      `  pnpm dr:restore:verify -- --set ${backupSetId}`,
      '',
      '',
    ].join('\n'),
  );
  process.stdout.write(
    `${JSON.stringify({
      status: 'PASS',
      backupSetId,
      // The directory, so a caller verifies and restores exactly the set it
      // just created rather than whichever one happens to be "latest".
      directory: directoryName,
      createdAt: createdAt.toISOString(),
      services: entries.map((entry) => entry.service),
      manifestChecksum,
      encryptionAlgorithm: 'AES-256-GCM',
      sizeBytes: totalBytes,
    })}\n`,
  );
} catch (error) {
  log('backup.failed', {
    backupSetId,
    reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
  });
  process.exitCode = 1;
} finally {
  // A partial set is never left behind for someone to restore from.
  if (!published) rmSync(staging, { recursive: true, force: true });
}
