#!/usr/bin/env node
/**
 * Verifies an encrypted backup set without restoring it.
 *
 * Checks the manifest schema, that every listed file exists and is a regular
 * file, that every checksum matches the ciphertext, and that the configured key
 * authenticates every file. Nothing is written to disk and no database is
 * touched, so this is safe to run against a production set.
 */
import {
  backupRoot,
  join,
  latestBackupDirectory,
  loadBackupKey,
  log,
  verifyBackupSet,
} from './dr-lib.mjs';

const requested = process.argv[2];
const root = backupRoot();

try {
  const key = loadBackupKey();
  const directory = join(root, requested ?? latestBackupDirectory(root));
  const { manifest, totalBytes, manifestChecksum } = verifyBackupSet(
    directory,
    key,
  );
  log('backup.verified', {
    backupSetId: manifest.backupSetId,
    services: manifest.entries.length,
    sizeBytes: totalBytes,
  });
  process.stdout.write(
    `${JSON.stringify({
      status: 'PASS',
      backupSetId: manifest.backupSetId,
      createdAt: manifest.createdAt,
      services: manifest.entries.map((entry) => entry.service),
      manifestChecksum,
      encryptionAlgorithm: manifest.encryptionAlgorithm,
      sizeBytes: totalBytes,
    })}\n`,
  );
} catch (error) {
  log('backup.verification.failed', {
    reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
  });
  process.stdout.write(`${JSON.stringify({ status: 'FAIL' })}\n`);
  process.exitCode = 1;
}
