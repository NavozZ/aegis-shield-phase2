#!/usr/bin/env node
/**
 * Negative-path verification against a real backup set.
 *
 * The unit tests in `dr-lib.test.mjs` build synthetic sets. This script runs the
 * same refusals against a set that `backup.mjs` actually produced from live
 * PostgreSQL databases, because the failure that matters is the one where a
 * genuine set has been altered on shared storage.
 *
 * Every case is expected to FAIL verification. The script exits non-zero if any
 * of them is accepted, which is the only outcome that would be dangerous.
 *
 * The real set is never modified: each case works on a copy in a temporary
 * directory that is removed afterwards.
 *
 * The set must be named: `--set <backup-set-id>` or `--latest`. Refusing to
 * guess keeps every disaster-recovery command consistent about which bytes it
 * examined.
 */
import {
  cpSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  loadBackupKey,
  log,
  makeTempDirectory,
  parseSetSelection,
  resolveBackupSet,
  verifyBackupSet,
} from './dr-lib.mjs';

let selected;
try {
  selected = resolveBackupSet(parseSetSelection(process.argv.slice(2)));
} catch (error) {
  const reason = error instanceof Error ? error.message : 'unknown';
  process.stderr.write(`${reason}
`);
  process.stdout.write(`${JSON.stringify({ status: 'FAIL' })}
`);
  process.exit(1);
}
const name = selected.backupSetId;
const source = selected.path;
log('negative.selected', { backupSetId: name });

const key = loadBackupKey();
const workspace = makeTempDirectory('aegis-dr-negative-');
const results = [];

/** Copies the real set, applies a mutation, and requires verification to fail. */
function expectRefusal(caseName, mutate, options = {}) {
  const directory = join(workspace, caseName);
  cpSync(source, directory, { recursive: true });
  try {
    mutate(directory);
  } catch (error) {
    if (options.skippable) {
      log('negative.skipped', { case: caseName });
      results.push({ case: caseName, outcome: 'SKIPPED' });
      return;
    }
    throw error;
  }
  let refused = false;
  let reason = '';
  try {
    verifyBackupSet(directory, options.key ?? key);
  } catch (error) {
    refused = true;
    reason = error instanceof Error ? error.message.slice(0, 120) : 'unknown';
  }
  results.push({
    case: caseName,
    outcome: refused ? 'REFUSED' : 'ACCEPTED',
    reason,
  });
  log(refused ? 'negative.refused' : 'negative.accepted', {
    case: caseName,
    reason,
  });
}

function readManifest(directory) {
  return JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
}
function writeManifest(directory, manifest) {
  writeFileSync(
    join(directory, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
}

// The pristine copy must verify, or every refusal below would be meaningless.
const control = join(workspace, 'control');
cpSync(source, control, { recursive: true });
let controlPassed = false;
try {
  verifyBackupSet(control, key);
  controlPassed = true;
} catch (error) {
  log('negative.control.failed', {
    reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
  });
}

expectRefusal(
  'wrong-key',
  () => undefined,
  // A different 32-byte key: GCM authentication fails rather than yielding
  // plausible-looking rubbish.
  { key: Buffer.alloc(32, 0x5a) },
);

expectRefusal('tampered-ciphertext', (directory) => {
  const manifest = readManifest(directory);
  const target = join(directory, manifest.entries[0].fileName);
  const bytes = readFileSync(target);
  bytes[bytes.length - 1] ^= 0x01;
  writeFileSync(target, bytes);
});

expectRefusal('missing-file', (directory) => {
  const manifest = readManifest(directory);
  rmSync(join(directory, manifest.entries[0].fileName), { force: true });
});

expectRefusal('incomplete-set', (directory) => {
  const manifest = readManifest(directory);
  const removed = manifest.entries.pop();
  rmSync(join(directory, removed.fileName), { force: true });
  writeManifest(directory, manifest);
});

expectRefusal('duplicate-service', (directory) => {
  const manifest = readManifest(directory);
  manifest.entries.push({ ...manifest.entries[0] });
  writeManifest(directory, manifest);
});

expectRefusal('path-traversal-filename', (directory) => {
  const manifest = readManifest(directory);
  manifest.entries[0].fileName = '../escaped.dump.enc';
  writeManifest(directory, manifest);
});

expectRefusal('unsupported-manifest-version', (directory) => {
  const manifest = readManifest(directory);
  manifest.manifestVersion = '9.9';
  writeManifest(directory, manifest);
});

expectRefusal('unsupported-algorithm', (directory) => {
  const manifest = readManifest(directory);
  manifest.encryptionAlgorithm = 'AES-128-CBC';
  writeManifest(directory, manifest);
});

expectRefusal(
  'symlink-escape',
  (directory) => {
    const manifest = readManifest(directory);
    const target = join(directory, manifest.entries[0].fileName);
    const outside = join(workspace, 'outside.bin');
    writeFileSync(outside, Buffer.alloc(16, 1));
    rmSync(target, { force: true });
    // Throws on hosts that do not permit symlink creation; that case is
    // recorded as skipped rather than silently passing.
    symlinkSync(outside, target);
  },
  { skippable: true },
);

const accepted = results.filter((item) => item.outcome === 'ACCEPTED');
const status = controlPassed && accepted.length === 0 ? 'PASS' : 'FAIL';
rmSync(workspace, { recursive: true, force: true });

process.stdout.write(
  `${JSON.stringify({
    status,
    backupSetId: name,
    directory: selected.directory,
    controlVerified: controlPassed,
    cases: results.map((item) => ({ case: item.case, outcome: item.outcome })),
  })}\n`,
);
if (status !== 'PASS') process.exitCode = 1;
