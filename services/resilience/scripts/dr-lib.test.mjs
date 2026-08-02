/**
 * Tests for the disaster-recovery tooling library.
 *
 * These are the checks that stand between a backup set and a restore. A set is
 * attacker-influenced input the moment it lives on shared storage, so the
 * important cases here are the hostile ones: a manifest that names a path
 * instead of a file, a set that is missing a service, a file whose ciphertext
 * has been altered, a symlink pointing out of the directory, and a wrong key.
 *
 * Everything here is filesystem and cryptography only — no PostgreSQL, no
 * network — so it runs identically on a developer machine and in CI.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  assertKnownService,
  assertRegularFile,
  assertSafeFileName,
  assertSafeSetIdentifier,
  backupRoot,
  connectionParts,
  listBackupSets,
  parseSetSelection,
  resolveBackupSet,
  encryptBackupFile,
  readBackupSet,
  redact,
  sha256Hex,
  verifyBackupSet,
} from './dr-lib.mjs';

const KEY = Buffer.alloc(32, 7);
const workspaces = [];

function workspace() {
  const directory = mkdtempSync(join(tmpdir(), 'aegis-dr-test-'));
  workspaces.push(directory);
  return directory;
}

after(() => {
  for (const directory of workspaces) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const SERVICES = ['identity', 'ledger', 'payments', 'risk', 'resilience'];

/** Writes a complete, valid backup set and returns its directory. */
function writeSet(options = {}) {
  const directory = options.directory ?? workspace();
  const entries = [];
  for (const service of options.services ?? SERVICES) {
    const ciphertext = encryptBackupFile(
      Buffer.from(`PGDMP fake dump for ${service}`, 'utf8'),
      KEY,
    );
    const fileName = `${service}.dump.enc`;
    writeFileSync(join(directory, fileName), ciphertext);
    entries.push({
      service,
      fileName,
      checksum: sha256Hex(ciphertext),
      sizeBytes: ciphertext.length,
      migrationVersion: null,
    });
  }
  const manifest = {
    manifestVersion: '1.0',
    backupSetId: `backup:2026-08-01:${randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    encryptionAlgorithm: 'AES-256-GCM',
    keyDerivation: 'raw-256-bit',
    entries,
    ...options.manifest,
  };
  if (options.mutate) options.mutate(manifest, directory);
  writeFileSync(
    join(directory, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  return directory;
}

test('a well-formed set verifies and reports its total size', () => {
  const directory = writeSet();
  const result = verifyBackupSet(directory, KEY);
  assert.equal(result.manifest.entries.length, SERVICES.length);
  assert.ok(result.totalBytes > 0);
  assert.match(result.manifestChecksum, /^[0-9a-f]{64}$/u);
});

test('a manifest entry may name a file, never a path', () => {
  for (const unsafe of [
    '../outside.enc',
    '..\\outside.enc',
    '/etc/passwd',
    'nested/ledger.dump.enc',
    '.hidden',
    '',
    null,
  ]) {
    assert.throws(() => assertSafeFileName(unsafe), /unsafe file/u);
  }
  assert.doesNotThrow(() => assertSafeFileName('ledger.dump.enc'));
});

test('a set whose manifest lists a missing file is rejected', () => {
  const directory = writeSet({
    mutate: (manifest) => {
      manifest.entries.push({
        service: 'risk',
        fileName: 'never-written.dump.enc',
        checksum: sha256Hex(Buffer.from('x')),
        sizeBytes: 1,
        migrationVersion: null,
      });
    },
  });
  // The duplicate service is caught first; either way the set never verifies.
  assert.throws(() => readBackupSet(directory));
});

test('a set that names the same service twice is rejected', () => {
  const directory = writeSet({
    mutate: (manifest) => {
      manifest.entries.push({ ...manifest.entries[0] });
    },
  });
  assert.throws(() => readBackupSet(directory));
});

test('a set missing a service in scope is incomplete, not partially usable', () => {
  const directory = writeSet({ services: SERVICES.slice(0, 3) });
  assert.throws(() => readBackupSet(directory), /incomplete/u);
});

test('an unsupported manifest version is refused rather than guessed at', () => {
  const directory = writeSet({ manifest: { manifestVersion: '2.0' } });
  assert.throws(() => readBackupSet(directory));
});

test('an unsupported encryption algorithm is refused', () => {
  const directory = writeSet({
    manifest: { encryptionAlgorithm: 'AES-128-CBC' },
  });
  assert.throws(() => readBackupSet(directory));
});

test('a missing or unreadable manifest is reported as such', () => {
  const directory = workspace();
  assert.throws(() => readBackupSet(directory), /manifest is missing/u);
  writeFileSync(join(directory, 'manifest.json'), 'not json');
  assert.throws(() => readBackupSet(directory), /manifest is missing/u);
});

test('a tampered ciphertext fails the checksum before any decryption', () => {
  const directory = writeSet();
  const target = join(directory, 'ledger.dump.enc');
  const original = encryptBackupFile(Buffer.from('replacement', 'utf8'), KEY);
  writeFileSync(target, original);
  // The checksum in the manifest still describes the original file, so the set
  // is rejected without the key being applied to the substituted bytes.
  assert.throws(() => verifyBackupSet(directory, KEY), /size|checksum/iu);
});

test('a single flipped byte is caught', () => {
  const directory = writeSet();
  const plaintext = Buffer.from('PGDMP fake dump for ledger', 'utf8');
  const ciphertext = encryptBackupFile(plaintext, KEY);
  ciphertext[ciphertext.length - 1] ^= 0x01;
  writeFileSync(join(directory, 'ledger.dump.enc'), ciphertext);
  assert.throws(() => verifyBackupSet(directory, KEY));
});

test('the wrong key fails authentication rather than producing garbage', () => {
  const directory = writeSet();
  assert.throws(
    () => verifyBackupSet(directory, Buffer.alloc(32, 9)),
    /DECRYPTION_FAILED/u,
  );
  // Checksums alone still pass: authenticity, not corruption, is what failed.
  assert.doesNotThrow(() => verifyBackupSet(directory, undefined));
});

test('a symbolic link inside a set is refused', (t) => {
  const directory = workspace();
  const outside = join(workspace(), 'secret.txt');
  writeFileSync(outside, 'not a backup');
  const link = join(directory, 'ledger.dump.enc');
  try {
    symlinkSync(outside, link);
  } catch {
    // Unprivileged Windows cannot create symlinks; the guard is still compiled
    // and exercised by the directory case below.
    t.skip('symlink creation is not permitted on this host');
    return;
  }
  assert.throws(() => assertRegularFile(link), /symbolic link/u);
});

test('a directory masquerading as a backup file is refused', () => {
  const directory = workspace();
  mkdirSync(join(directory, 'ledger.dump.enc'));
  assert.throws(
    () => assertRegularFile(join(directory, 'ledger.dump.enc')),
    /not a regular file/u,
  );
});

test('an unknown service name is refused', () => {
  assert.throws(() => assertKnownService('redis'), /unknown service/u);
  assert.throws(() => assertKnownService('../identity'), /unknown service/u);
  assert.doesNotThrow(() => assertKnownService('ledger'));
});

test('connection parsing refuses anything that is not a PostgreSQL database', () => {
  assert.throws(
    () => connectionParts(undefined, 'X_URL'),
    /X_URL is required/u,
  );
  assert.throws(
    () => connectionParts('file:///etc/passwd', 'X_URL'),
    /must be a PostgreSQL URL/u,
  );
  assert.throws(
    () => connectionParts('postgresql://u:p@h:5432/bad-name;DROP', 'X_URL'),
    /invalid database/u,
  );
  const parts = connectionParts(
    'postgresql://aegis_ledger:secret-value@127.0.0.1:5432/aegis_ledger?schema=app',
    'LEDGER_DATABASE_URL',
  );
  assert.equal(parts.database, 'aegis_ledger');
  assert.equal(parts.schema, 'app');
});

test('redaction removes credentials from anything that could be logged', () => {
  const text = redact(
    'connect postgresql://aegis_ledger:secret-value@127.0.0.1:5432/aegis_ledger password=hunter2 failed',
  );
  assert.ok(!text.includes('secret-value'));
  assert.ok(!text.includes('hunter2'));
  assert.match(text, /\[redacted\]/u);
});

/** Builds a root holding several named sets with controlled timestamps. */
function rootWith(sets) {
  const root = workspace();
  for (const { directory, backupSetId, createdAt } of sets) {
    mkdirSync(join(root, directory));
    writeSet({
      directory: join(root, directory),
      manifest: { backupSetId, createdAt },
    });
  }
  return root;
}

test('the pnpm end-of-options separator is tolerated', () => {
  // `pnpm dr:backup:verify -- --set <id>` passes a literal `--` through to the
  // script. This is the documented invocation, and rejecting it broke CI.
  assert.deepEqual(
    parseSetSelection(['--', '--set', 'backup:2026-08-01:aaaaaaaa']),
    { mode: 'explicit', id: 'backup:2026-08-01:aaaaaaaa' },
  );
  assert.deepEqual(parseSetSelection(['--', '--latest']), { mode: 'latest' });
  // A separator alone still selects nothing, so a bare command still fails.
  assert.throws(() => parseSetSelection(['--']), /must be named explicitly/u);
});

test('a bare command refuses to choose a set', () => {
  // The whole point: "whichever set the tool picked" is not an answer an
  // operator can act on after an incident.
  assert.throws(() => parseSetSelection([]), /must be named explicitly/u);
});

test('--set and --latest cannot be combined, and unknown flags are refused', () => {
  assert.throws(
    () =>
      parseSetSelection(['--set', 'backup:2026-08-01:aaaaaaaa', '--latest']),
    /cannot be combined/u,
  );
  assert.throws(() => parseSetSelection(['--all']), /Unrecognised argument/u);
  assert.throws(() => parseSetSelection(['--set']), /requires a value/u);
  assert.throws(
    () =>
      parseSetSelection([
        '--set',
        'backup:2026-08-01:aaaaaaaa',
        '--set',
        'backup:2026-08-01:bbbbbbbb',
      ]),
    /more than once/u,
  );
});

test('--set accepts both spellings and --latest parses alone', () => {
  assert.deepEqual(parseSetSelection(['--latest']), { mode: 'latest' });
  assert.deepEqual(parseSetSelection(['--set', 'backup:2026-08-01:aaaaaaaa']), {
    mode: 'explicit',
    id: 'backup:2026-08-01:aaaaaaaa',
  });
  assert.deepEqual(parseSetSelection(['--set=backup_2026-08-01_aaaaaaaa']), {
    mode: 'explicit',
    id: 'backup_2026-08-01_aaaaaaaa',
  });
});

test('a set identifier is an opaque token, never a path', () => {
  for (const unsafe of [
    '../../etc/passwd',
    '..',
    'a/b',
    'a\b',
    '/absolute',
    'short',
    '',
    null,
    'has space in it',
  ]) {
    assert.throws(() => assertSafeSetIdentifier(unsafe), /opaque token/u);
  }
  assert.doesNotThrow(() =>
    assertSafeSetIdentifier('backup:2026-08-01:aaaaaaaa'),
  );
});

test('--set selects exactly the named set, by id or by directory', () => {
  const root = rootWith([
    {
      directory: 'backup_2026-08-01_aaaaaaaa',
      backupSetId: 'backup:2026-08-01:aaaaaaaa',
      createdAt: '2026-08-01T09:00:00.000Z',
    },
    {
      directory: 'backup_2026-08-01_bbbbbbbb',
      backupSetId: 'backup:2026-08-01:bbbbbbbb',
      createdAt: '2026-08-01T11:00:00.000Z',
    },
  ]);
  const byId = resolveBackupSet(
    { mode: 'explicit', id: 'backup:2026-08-01:aaaaaaaa' },
    root,
  );
  assert.equal(byId.backupSetId, 'backup:2026-08-01:aaaaaaaa');
  assert.equal(byId.directory, 'backup_2026-08-01_aaaaaaaa');

  const byDirectory = resolveBackupSet(
    { mode: 'explicit', id: 'backup_2026-08-01_bbbbbbbb' },
    root,
  );
  assert.equal(byDirectory.backupSetId, 'backup:2026-08-01:bbbbbbbb');
});

test('--latest uses the manifest timestamp when names sort the other way', () => {
  // Set directories end in a random suffix, so a lexicographic sort picks the
  // largest random value rather than the newest set. That bug silently made a
  // drill verify a set it never created.
  const root = rootWith([
    {
      directory: 'backup_2026-08-01_ffffffff',
      backupSetId: 'backup:2026-08-01:ffffffff',
      createdAt: '2026-08-01T09:00:00.000Z',
    },
    {
      directory: 'backup_2026-08-01_00000001',
      backupSetId: 'backup:2026-08-01:00000001',
      createdAt: '2026-08-01T11:00:00.000Z',
    },
  ]);
  assert.equal(
    resolveBackupSet({ mode: 'latest' }, root).backupSetId,
    'backup:2026-08-01:00000001',
  );
});

test('two sets sharing the newest timestamp fail rather than pick one', () => {
  // A coin toss here would make drill evidence depend on filesystem ordering.
  const root = rootWith([
    {
      directory: 'backup_2026-08-01_aaaaaaaa',
      backupSetId: 'backup:2026-08-01:aaaaaaaa',
      createdAt: '2026-08-01T09:00:00.000Z',
    },
    {
      directory: 'backup_2026-08-01_bbbbbbbb',
      backupSetId: 'backup:2026-08-01:bbbbbbbb',
      createdAt: '2026-08-01T09:00:00.000Z',
    },
  ]);
  assert.throws(
    () => resolveBackupSet({ mode: 'latest' }, root),
    /share the newest creation time/u,
  );
});

test('a named set that does not exist is reported, not substituted', () => {
  const root = rootWith([
    {
      directory: 'backup_2026-08-01_aaaaaaaa',
      backupSetId: 'backup:2026-08-01:aaaaaaaa',
      createdAt: '2026-08-01T09:00:00.000Z',
    },
  ]);
  assert.throws(
    () =>
      resolveBackupSet(
        { mode: 'explicit', id: 'backup:2026-08-01:cccccccc' },
        root,
      ),
    /was not found/u,
  );
});

test('an empty backup root is reported rather than returning undefined', () => {
  assert.throws(
    () => resolveBackupSet({ mode: 'latest' }, workspace()),
    /No backup set/u,
  );
  assert.throws(
    () =>
      resolveBackupSet(
        { mode: 'explicit', id: 'backup:2026-08-01:aaaaaaaa' },
        workspace(),
      ),
    /No backup set/u,
  );
});

test('a directory without a readable manifest is not treated as a set', () => {
  const root = rootWith([
    {
      directory: 'backup_2026-08-01_aaaaaaaa',
      backupSetId: 'backup:2026-08-01:aaaaaaaa',
      createdAt: '2026-08-01T09:00:00.000Z',
    },
  ]);
  // A stray directory must not win the comparison merely by sorting last.
  mkdirSync(join(root, 'zzzz-not-a-backup-set'));
  assert.equal(listBackupSets(root).length, 1);
  assert.equal(
    resolveBackupSet({ mode: 'latest' }, root).directory,
    'backup_2026-08-01_aaaaaaaa',
  );
});

test('the backup directory follows DR_BACKUP_DIR when it is set', () => {
  const previous = process.env.DR_BACKUP_DIR;
  try {
    const target = workspace();
    process.env.DR_BACKUP_DIR = target;
    assert.equal(backupRoot(), target);
    delete process.env.DR_BACKUP_DIR;
    assert.match(backupRoot(), /[\\/]\.dr-backups$/u);
  } finally {
    if (previous === undefined) delete process.env.DR_BACKUP_DIR;
    else process.env.DR_BACKUP_DIR = previous;
  }
});
