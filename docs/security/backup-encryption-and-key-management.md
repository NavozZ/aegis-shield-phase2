# Backup encryption and key management

## What a backup set is worth to an attacker

An unencrypted backup of this platform is the platform. It contains hashed PINs,
passkey credentials, the entire immutable ledger, transfer history, security
events and operator audit records — everything the running services protect with
sessions, step-up, rate limits and controls, sitting in one file that no guard
runs in front of.

That is why encryption is applied at the file level by the tooling that creates
the dump, in the same process, before the plaintext is ever left on disk longer
than the moment it takes to read it.

## Algorithm

AES-256-GCM, from Node's `node:crypto`. No custom cryptography is written
anywhere in this repository's backup path.

- **Key**: 32 raw bytes, base64 in the environment as
  `DR_BACKUP_ENCRYPTION_KEY`.
- **Nonce**: 12 random bytes per file, generated with
  `crypto.randomBytes`. Never derived from a counter, a timestamp or the file
  name.
- **Tag**: 16 bytes, verified on every open.
- **Additional authenticated data**: the file header (magic, version, nonce), so
  a substituted version byte or nonce fails authentication rather than silently
  changing how the file is parsed.

### File layout

```text
offset  size  field
0       8     magic  "AEGISBK1"
8       1     format version (currently 1)
9       12    nonce
21      16    GCM tag
37      …     ciphertext
```

A file shorter than 37 bytes plus one byte of ciphertext is rejected as
truncated before any cryptographic operation runs.

## Key handling rules

1. **The key never leaves the CLI.** The Resilience service validates at startup
   that a configured key parses to 32 usable bytes, then records only
   `backupKeyConfigured: true`. The key is not placed on the configuration
   object, is not logged, and does not appear in any HTTP response — asserted by
   a unit test that serialises the whole configuration and searches for it.
2. **The key is never committed.** `.env` is git-ignored; `.env.example` carries
   the placeholder `BASE64_LOCAL_ONLY_32_BYTE_BACKUP_KEY_PLACEHOLDER`, which is
   not valid base64 for 32 bytes and therefore cannot accidentally work.
3. **CI uses an obviously fake key.** The workflow sets
   `DR_BACKUP_ENCRYPTION_KEY` to the base64 of the ASCII string
   `ci-only-not-production-dr-key-32`. It is a real 32-byte key so the real
   AES-256-GCM path is exercised, and it protects nothing.
4. **Weak keys are refused, not stretched.** `parseBackupKey` rejects an absent
   value, a non-base64 value, a value that is not exactly 32 bytes, and an
   all-zero key. There is no key derivation from a passphrase, because a
   passphrase-derived key would invite a weak passphrase.
5. **Production refuses to start without a key.** With `NODE_ENV=production` and
   no `DR_BACKUP_ENCRYPTION_KEY`, the service throws at startup rather than
   reporting a recovery readiness it cannot support.
6. **Placeholders are refused in production.** Any token or database URL matching
   `change-me`, `local-only`, `placeholder` or `example-only` aborts startup.

## Generating a key

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Store the result in the operator's secret manager and in `.env` on the machine
that runs backups. Do not paste it into a ticket, a chat message, a screenshot or
this repository.

## Key custody, rotation and re-encryption

This prototype implements encryption, not custody. The following are real
operational requirements and are **not** implemented here:

- a key management service or hardware-backed key store
- split custody or quorum access for the backup key
- scheduled key rotation with re-encryption of retained sets
- an audit trail of key access separate from the application

Rotating the key today means: generate a new key, take a fresh backup set with
it, verify that set restores, and then dispose of the sets encrypted under the
old key according to
[backup retention and disposal](./backup-retention-and-disposal.md). Sets under
the old key cannot be read with the new one — GCM authentication fails, which is
the intended behaviour and is covered by a test.

## What integrity checking does and does not prove

Each manifest entry carries the SHA-256 of the **ciphertext**. Checksums are
verified before any decryption, so corruption and truncation are caught without
applying the key to attacker-influenced bytes.

A checksum proves the file is the one the manifest describes. It does not prove
the manifest itself was not replaced, because the manifest is not signed. An
attacker with write access to the backup directory could produce a
self-consistent set of their own — they could not read the original sets, and
they could not make one of their sets decrypt under the real key, but they could
delete or substitute. Manifest signing and offsite immutable storage are the
mitigations, and neither is implemented here; see
[disaster-recovery threat model](./disaster-recovery-threat-model.md).

## Related documents

- [Operational resilience and DR architecture](../architecture/operational-resilience-and-dr.md)
- [Disaster-recovery threat model](./disaster-recovery-threat-model.md)
- [Backup retention and disposal](./backup-retention-and-disposal.md)
- [Backup and restore runbook](../operations/backup-restore-runbook.md)
