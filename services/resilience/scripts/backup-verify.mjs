#!/usr/bin/env node
/**
 * Verifies an encrypted backup set without restoring it.
 *
 * Checks the manifest schema, that every listed file exists and is a regular
 * file, that every checksum matches the ciphertext, and that the configured key
 * authenticates every file. Nothing is written to disk and no database is
 * touched, so this is safe to run against a production set.
 *
 * The set must be named: `--set <backup-set-id>` or `--latest`. A bare command
 * fails, because "whichever set the tool happened to pick" is not an answer an
 * operator can act on after an incident.
 */
import {
  loadBackupKey,
  log,
  parseSetSelection,
  resolveBackupSet,
  verifyBackupSet,
} from './dr-lib.mjs';

try {
  const selection = parseSetSelection(process.argv.slice(2));
  const selected = resolveBackupSet(selection);
  // Announced before any work, so the operator sees which set is being examined
  // even when verification then fails.
  log('backup.verify.selected', {
    backupSetId: selected.backupSetId,
    selection: selection.mode,
  });

  const key = loadBackupKey();
  const { manifest, totalBytes, manifestChecksum } = verifyBackupSet(
    selected.path,
    key,
  );
  if (manifest.backupSetId !== selected.backupSetId) {
    throw new Error('The manifest names a different backup set.');
  }

  log('backup.verified', {
    backupSetId: manifest.backupSetId,
    services: manifest.entries.length,
    sizeBytes: totalBytes,
  });
  process.stdout.write(
    `${JSON.stringify({
      status: 'PASS',
      backupSetId: manifest.backupSetId,
      directory: selected.directory,
      createdAt: manifest.createdAt,
      services: manifest.entries.map((entry) => entry.service),
      manifestChecksum,
      encryptionAlgorithm: manifest.encryptionAlgorithm,
      sizeBytes: totalBytes,
    })}\n`,
  );
} catch (error) {
  const reason = error instanceof Error ? error.message : 'unknown';
  // Usage guidance is multi-line and belongs on stderr in full; the JSON summary
  // stays one machine-readable line on stdout.
  process.stderr.write(`${reason}\n`);
  log('backup.verification.failed', { reason: reason.slice(0, 200) });
  process.stdout.write(`${JSON.stringify({ status: 'FAIL' })}\n`);
  process.exitCode = 1;
}
