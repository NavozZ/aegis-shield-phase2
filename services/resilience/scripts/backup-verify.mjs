#!/usr/bin/env node
/**
 * Verifies an encrypted backup set without restoring it.
 *
 * Checks the manifest schema, that every listed file exists and is a regular
 * file, that every checksum matches the ciphertext, and that the configured key
 * authenticates every file. Nothing is written to disk and no database is
 * touched, so this is safe to run against a production set.
 */
import { readdirSync } from 'node:fs';
import {
  backupRoot,
  join,
  loadBackupKey,
  log,
  verifyBackupSet,
} from './dr-lib.mjs';

const requested = process.argv[2];
const root = backupRoot();

function latestSet() {
  const candidates = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const latest = candidates.at(-1);
  if (!latest) throw new Error('No backup set was found.');
  return latest;
}

try {
  const key = loadBackupKey();
  const directory = join(root, requested ?? latestSet());
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
