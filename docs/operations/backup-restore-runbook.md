# Backup and restore runbook

Every command here is run from the repository root by an operator with a shell.
None of them is reachable over HTTP, and none of them should be wired to a
button.

## Prerequisites

1. PostgreSQL and Redis running: `pnpm infra:up && pnpm infra:check`
2. Migrations applied: `pnpm db:deploy`
3. `pg_dump`, `pg_restore` and `psql` on `PATH`, at least the server's major
   version. The stack uses PostgreSQL 17; an older client refuses to dump a
   newer server, which is correct behaviour and not something to work around.

   ```bash
   pg_dump --version   # must be >= the server major version
   ```

4. `DR_BACKUP_ENCRYPTION_KEY` set in `.env` to a base64 32-byte key:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

   Never commit it, never paste it into a ticket. See
   [backup encryption and key management](../security/backup-encryption-and-key-management.md).

## Create a backup set

```bash
pnpm dr:backup
```

Dumps `aegis_identity`, `aegis_ledger`, `aegis_payments`, `aegis_audit` and
`aegis_resilience` with `--format custom --no-owner --no-acl`, encrypts each with
AES-256-GCM, removes the plaintext immediately, writes `manifest.json`, and
publishes the set atomically by renaming the staging directory into place.

Output is one JSON line:

```json
{
  "status": "PASS",
  "backupSetId": "backup:2026-08-01:a1b2c3d4",
  "directory": "backup_2026-08-01_a1b2c3d4",
  "services": ["identity", "ledger", "payments", "risk", "resilience"],
  "manifestChecksum": "…",
  "encryptionAlgorithm": "AES-256-GCM",
  "sizeBytes": 5242880
}
```

A failure removes the partial directory, so no half-written set is left for
someone to restore from.

## Verify a set without restoring it

```bash
pnpm dr:backup:verify
```

Validates the manifest, refuses unsafe file names, symlinks and missing services,
verifies every SHA-256 against the ciphertext, then decrypts each file in memory
to prove the key is right and the ciphertext authentic. Nothing is written to
disk.

Run this whenever a set has been copied, moved, or has sat on shared storage.

## Confirm the refusals still work

```bash
pnpm dr:backup:verify:negative
```

Copies the real set nine times, breaks each copy differently — wrong key,
tampered ciphertext, missing file, incomplete set, duplicate service, path in a
file name, unsupported manifest version, unsupported algorithm, symlink escape —
and requires every copy to be refused. The original set is never modified. This
is what CI runs; run it locally after changing anything in the tooling.

## Verify an isolated restore

```bash
pnpm dr:restore:verify
```

Creates a freshly named disposable database per service, restores into it,
asserts the restored database actually contains application tables, then drops
every database it created and removes all decrypted material.

**This never writes to an active service database.** Targets are generated names
checked against the live database names, and there is no flag or environment
variable that redirects it. Restoring over a live database is not an operation
this tool supports.

Output includes the prototype measurements:

```json
{
  "status": "PASS",
  "backupSetId": "backup:2026-08-01:a1b2c3d4",
  "measuredRecoveryPointAgeSeconds": 138,
  "measuredRecoveryDurationMs": 4210
}
```

These are measurements from local disposable infrastructure. They are not a
recovery-point or recovery-time objective.

## Restore a specific set

Both verification commands accept a directory name under the backup root:

```bash
pnpm dr:backup:verify -- backup_2026-08-01_a1b2c3d4
pnpm dr:restore:verify -- backup_2026-08-01_a1b2c3d4
```

Without an argument the most recent set is used, chosen by the manifest's
`createdAt` rather than by directory name — a set directory ends in a random
suffix, so sorting names would pick the largest random value rather than the
newest set.

The drill never relies on that: it passes the directory `pnpm dr:backup` reported
to both verification steps, and fails if either reports a different backup set
identifier. Recording evidence about bytes the drill never examined would be
worse than recording no drill at all.

## Restoring for real

Restoring into a live service database is a deliberate, manual operation that
this tooling does not perform, because it destroys data and no automated path
should be able to reach it by accident. If it is genuinely required:

1. Stop every application service. A restore under load produces a database that
   matches neither the dump nor the running state.
2. Verify the set first (`pnpm dr:backup:verify`), so a corrupted set is
   discovered before the live database is dropped.
3. Prove it restores in isolation (`pnpm dr:restore:verify`).
4. Take a fresh backup of the current live state, even if it is believed to be
   corrupt. It is the only way back from a mistaken restore.
5. Perform the restore by hand with `pg_restore`, naming the target explicitly,
   with a second person watching the command before it is run.
6. Run every reconciliation before letting traffic in — see the
   [disaster-recovery runbook](./disaster-recovery-runbook.md).

## Where sets live

`.dr-backups/` at the repository root, or `$DR_BACKUP_DIR` if set. Both are
git-ignored. See
[backup retention and disposal](../security/backup-retention-and-disposal.md)
for how long to keep them and how to dispose of them.

## Failure codes

| Code                     | Meaning                                            |
| ------------------------ | -------------------------------------------------- |
| `BACKUP_FAILED`          | `pg_dump` failed or a database was unreachable     |
| `MANIFEST_INVALID`       | manifest missing, unparseable or schema-invalid    |
| `CHECKSUM_MISMATCH`      | a file does not match its recorded SHA-256         |
| `DECRYPTION_FAILED`      | wrong key, or the ciphertext is not authentic      |
| `INCOMPLETE_BACKUP_SET`  | a service in scope is absent from the set          |
| `RESTORE_FAILED`         | `pg_restore` failed, or no application tables      |
| `RECONCILIATION_FAILED`  | a service reconciliation reported a failure        |
| `CLEANUP_FAILED`         | a disposable database or workspace was not removed |
| `DEPENDENCY_UNAVAILABLE` | a required service could not be reached            |
| `CONFIGURATION_INVALID`  | a required setting is missing or unusable          |

## Related documents

- [Disaster-recovery runbook](./disaster-recovery-runbook.md)
- [Service failure runbook](./service-failure-runbook.md)
- [Backup encryption and key management](../security/backup-encryption-and-key-management.md)
- [Backup retention and disposal](../security/backup-retention-and-disposal.md)
