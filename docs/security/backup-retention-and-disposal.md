# Backup retention and disposal

A backup is customer data with a longer life than the system that produced it.
Every set that exists is a copy of every hashed PIN, passkey credential, ledger
posting and transfer record on the platform, sitting outside every runtime
control. Keeping one longer than it is needed increases exposure with no
operational benefit.

## Where backup sets live

| Location                   | Contents                       | Lifetime              |
| -------------------------- | ------------------------------ | --------------------- |
| `.dr-backups/` (repo root) | encrypted sets and manifests   | operator-managed      |
| `$DR_BACKUP_DIR`           | same, when overridden          | operator-managed      |
| OS temp directory          | staging and decrypted material | seconds, in `finally` |
| CI job workspace           | one set per run                | removed by the job    |

`.dr-backups/`, `*.dump` and `*.dump.enc` are git-ignored. A backup set is
customer data under a key; committing one would put the whole platform's contents
in git history, where it cannot be deleted.

## Plaintext lifetime

Plaintext exists for as short a time as the tooling can arrange:

- **During backup**, `pg_dump` writes into a staging directory, the file is read,
  encrypted and written as `<service>.dump.enc`, and the plaintext dump is
  removed in the same loop iteration. It never reaches the published set.
- **During restore verification**, each file is decrypted into a temporary
  workspace, consumed by `pg_restore`, and removed immediately afterwards. The
  whole workspace is removed in `finally`, so a failure mid-restore does not
  leave plaintext behind.
- **During verification without restore**, decryption happens in memory only, to
  prove the key and authenticity. Nothing is written to disk.

## Disposable databases

Restore verification creates `aegis_verify_<service>_<random>` databases and
drops them in `finally` with `DROP DATABASE IF EXISTS … WITH (FORCE)`. A cleanup
failure is reported and sets a non-zero exit code rather than being swallowed,
because leftover verification databases accumulate silently and each one is a
full copy of a service's data with no application in front of it.

## Retention policy for this prototype

There is no automatic expiry implemented. The policy an operator should follow:

| Set                                    | Keep                               | Then                  |
| -------------------------------------- | ---------------------------------- | --------------------- |
| Sets created during a CI run           | 0 days                             | removed by the job    |
| Sets created for a local demo          | 1 day                              | delete after the demo |
| Sets under a superseded encryption key | until the replacement set verifies | delete                |

Enforcing retention, offsite immutable storage, and generational schemes such as
grandfather–father–son are operational work outside this repository.

## Disposal

Delete the directory. On the operator machine:

```bash
rm -rf .dr-backups/backup_2026-08-01_a1b2c3d4
```

`rm` on ordinary filesystems unlinks rather than erases. For a set that held real
customer data, disposal must follow the storage medium's own secure-erase
procedure — full-disk encryption with key destruction, or the cloud provider's
documented deletion guarantee. This repository implements neither and claims
neither.

## What CI may and may not keep

CI uploads Playwright screenshots, browser traces and sanitized drill and
reconciliation summaries on failure. It **never** uploads:

- backup files, encrypted or otherwise
- decrypted dumps
- database logs containing data
- `.env` files
- tokens, internal or source
- encryption keys

A dedicated always-run step removes the backup working directory, fails the job
if any `.dump` file survived the drill, and fails the job if any
`aegis-dr-*` staging directory was left in `/tmp`. Leftover plaintext is treated
as a build failure, not as untidiness.

## Verification before disposal

Never delete the only set that has been proved restorable. The order is:

1. Create the new set: `pnpm dr:backup`
2. Verify it without restoring: `pnpm dr:backup:verify`
3. Prove it restores into disposable databases: `pnpm dr:restore:verify`
4. Only then dispose of the superseded set.

The console shows `Restore verified: Yes` for a set that has completed step 3.
A set showing `No` has never been proved usable and must not be the last one
standing.

## Related documents

- [Backup encryption and key management](./backup-encryption-and-key-management.md)
- [Disaster-recovery threat model](./disaster-recovery-threat-model.md)
- [Backup and restore runbook](../operations/backup-restore-runbook.md)
