/**
 * Shared disaster-recovery tooling.
 *
 * This is operator CLI code, never reachable over HTTP. It is the only place
 * that touches `pg_dump`, `pg_restore`, the filesystem and the backup encryption
 * key. Exposing any of it behind a request handler would turn the operator
 * console into remote command execution, which is why the Resilience service
 * records evidence and does none of this work itself.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  lstatSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { config as loadEnvironment } from 'dotenv';
import {
  backupManifestSchema,
  canonicalManifestBytes,
  decryptBackupFile,
  encryptBackupFile,
  parseBackupKey,
  sha256Hex,
  verifyChecksum,
} from '@aegis/contracts';

export const REPOSITORY_ROOT = resolve(
  new URL('../../..', import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/u,
    '$1',
  ),
);

loadEnvironment({ path: join(REPOSITORY_ROOT, '.env'), quiet: true });

/**
 * The service-owned databases in the backup scope.
 *
 * Redis is deliberately absent. It holds recreatable cache, replay and velocity
 * state — not authoritative balances or credential records — so backing it up
 * would preserve nothing that a restore could not rebuild, while widening what a
 * stolen backup set exposes.
 */
export const BACKUP_SCOPE = [
  { service: 'identity', urlVariable: 'IDENTITY_DATABASE_URL' },
  { service: 'ledger', urlVariable: 'LEDGER_DATABASE_URL' },
  { service: 'payments', urlVariable: 'PAYMENTS_DATABASE_URL' },
  { service: 'risk', urlVariable: 'RISK_DATABASE_URL' },
  { service: 'resilience', urlVariable: 'RESILIENCE_DATABASE_URL' },
];

const SERVICE_NAMES = new Set(BACKUP_SCOPE.map((entry) => entry.service));

/** Where backup sets are written. Ignored by git; never inside the source tree. */
export function backupRoot() {
  return process.env.DR_BACKUP_DIR?.trim()
    ? resolve(process.env.DR_BACKUP_DIR.trim())
    : join(REPOSITORY_ROOT, '.dr-backups');
}

export function loadBackupKey() {
  return parseBackupKey(process.env.DR_BACKUP_ENCRYPTION_KEY);
}

/** Bounded, safe log line. Never carries a URL, key or dump content. */
export function log(event, fields = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    safe[key] = typeof value === 'string' ? value.slice(0, 200) : value;
  }
  process.stdout.write(
    `${JSON.stringify({ at: new Date().toISOString(), service: 'dr-tooling', event, ...safe })}\n`,
  );
}

/**
 * Runs a child process with an argument array.
 *
 * Never a shell string: every value that reaches a command is passed as a
 * separate argument, so a database name or path can never be interpreted as
 * shell syntax.
 */
export function run(command, args, options = {}) {
  return new Promise((settle, fail) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const chunks = [];
    const errors = [];
    let size = 0;
    child.stdout.on('data', (chunk) => {
      if (options.captureStdout) chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      // Bounded: a failing tool must not be able to flood the log.
      if (size < 8_192) {
        errors.push(chunk);
        size += chunk.length;
      }
    });
    child.on('error', fail);
    child.on('close', (code) => {
      if (code === 0) {
        settle(options.captureStdout ? Buffer.concat(chunks) : Buffer.alloc(0));
        return;
      }
      // The stderr tail is redacted before it can reach a log.
      fail(
        new Error(
          `${command} exited with code ${String(code)}: ${redact(Buffer.concat(errors).toString('utf8')).slice(0, 500)}`,
        ),
      );
    });
  });
}

/** Removes credentials from anything that might be printed. */
export function redact(text) {
  return text
    .replace(
      /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s/@:]*)(:[^\s/@]*)?@/giu,
      '$1[redacted]:[redacted]@',
    )
    .replace(/(password=)[^\s&]+/giu, '$1[redacted]');
}

/** Parses a connection URL into discrete pg_dump arguments. */
export function connectionParts(rawUrl, variableName) {
  if (!rawUrl) throw new Error(`${variableName} is required for a backup.`);
  const url = new URL(rawUrl);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(`${variableName} must be a PostgreSQL URL.`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ''));
  if (!/^[A-Za-z0-9_]{1,63}$/u.test(database)) {
    throw new Error(`${variableName} names an invalid database.`);
  }
  return {
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    schema: url.searchParams.get('schema') || 'app',
  };
}

/** An administrative connection, used only to create disposable databases. */
export function adminConnection() {
  const raw =
    process.env.DATABASE_URL?.trim() ||
    'postgresql://aegis_admin:aegis-local-admin-change-me@127.0.0.1:5432/postgres';
  return connectionParts(raw, 'DATABASE_URL');
}

export function psqlEnvironment(parts) {
  // The password travels in the environment rather than on a command line,
  // where it would be visible in the process table.
  return { PGPASSWORD: parts.password };
}

/**
 * Rejects a file name that is not a plain name.
 *
 * Manifest entries name files, never paths. This blocks traversal and absolute
 * paths before a name is ever joined to a directory.
 */
export function assertSafeFileName(fileName) {
  if (
    typeof fileName !== 'string' ||
    fileName.length === 0 ||
    fileName !== basename(fileName) ||
    fileName.startsWith('.') ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(fileName)
  ) {
    throw new Error('Manifest entry names an unsafe file.');
  }
}

/** Refuses a symlink, so a backup set cannot point outside its directory. */
export function assertRegularFile(path) {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink()) {
    throw new Error('Backup set contains a symbolic link.');
  }
  if (!stats.isFile()) {
    throw new Error('Backup set entry is not a regular file.');
  }
}

export function assertKnownService(service) {
  if (!SERVICE_NAMES.has(service)) {
    throw new Error('Manifest names an unknown service.');
  }
}

/**
 * Reads and fully validates a backup set.
 *
 * Order matters: schema, then file presence, then checksum, then decryption.
 * Checksums are verified against the ciphertext *before* any decryption, so a
 * corrupted set is rejected without the key ever touching it.
 */
export function readBackupSet(directory) {
  const manifestPath = join(directory, 'manifest.json');
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error('Backup set manifest is missing or unreadable.');
  }

  const manifest = backupManifestSchema.parse(parsed);

  const present = new Set(
    readdirSync(directory).filter((name) => name !== 'manifest.json'),
  );
  for (const entry of manifest.entries) {
    assertSafeFileName(entry.fileName);
    assertKnownService(entry.service);
    if (!present.has(entry.fileName)) {
      throw new Error('Backup set is incomplete: a listed file is missing.');
    }
  }

  // Every service in scope must be present, or a restore would silently rebuild
  // an incomplete platform.
  const covered = new Set(manifest.entries.map((entry) => entry.service));
  for (const { service } of BACKUP_SCOPE) {
    if (!covered.has(service)) {
      throw new Error(`Backup set is incomplete: ${service} is missing.`);
    }
  }

  return { manifest, directory };
}

/** Verifies every file's checksum, and optionally decrypts to prove the key. */
export function verifyBackupSet(directory, key) {
  const { manifest } = readBackupSet(directory);
  let totalBytes = 0;
  for (const entry of manifest.entries) {
    const path = join(directory, entry.fileName);
    assertRegularFile(path);
    const file = readFileSync(path);
    if (file.length !== entry.sizeBytes) {
      throw new Error('Backup file size does not match the manifest.');
    }
    verifyChecksum(file, entry.checksum);
    if (key) {
      // Decrypting proves the key is right and the ciphertext authentic. The
      // plaintext is discarded immediately; nothing is written to disk here.
      decryptBackupFile(file, key);
    }
    totalBytes += file.length;
  }
  const manifestChecksum = sha256Hex(canonicalManifestBytes(manifest));
  return { manifest, totalBytes, manifestChecksum };
}

/**
 * Names the most recently created backup set.
 *
 * Selection is by the manifest's `createdAt`, never by directory name. A set
 * directory ends in a random suffix, so sorting names lexicographically picks
 * the largest random value rather than the newest set — which would silently
 * verify and restore a different set than the one just taken.
 *
 * A directory without a readable manifest is not a backup set and is skipped
 * rather than allowed to win the comparison.
 */
export function latestBackupDirectory(root = backupRoot()) {
  let best;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let createdAt;
    try {
      createdAt = Date.parse(
        JSON.parse(
          readFileSync(join(root, entry.name, 'manifest.json'), 'utf8'),
        ).createdAt,
      );
    } catch {
      continue;
    }
    if (!Number.isFinite(createdAt)) continue;
    // The name breaks a tie, so the result is deterministic when two sets share
    // a timestamp.
    if (
      !best ||
      createdAt > best.createdAt ||
      (createdAt === best.createdAt && entry.name > best.name)
    ) {
      best = { name: entry.name, createdAt };
    }
  }
  if (!best) throw new Error('No backup set was found.');
  return best.name;
}

/** Creates a temporary working directory that the caller must remove. */
export function makeTempDirectory(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

export {
  encryptBackupFile,
  decryptBackupFile,
  sha256Hex,
  canonicalManifestBytes,
};
export {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  statSync,
  join,
  randomUUID,
};
