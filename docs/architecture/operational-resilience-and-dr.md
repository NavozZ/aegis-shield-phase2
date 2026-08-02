# Operational resilience and disaster recovery

This describes the implemented operational-resilience boundary: encrypted backup sets,
isolated restore verification, deterministic recovery drills, and the operator
console that reads the resulting evidence.

## Scope and honest limits

This is a prototype. It demonstrates that the platform's authoritative data can
be captured, encrypted, verified and restored into a clean database, and that
the result can be reconciled and audited.

It does **not** provide, and this repository does not claim:

- production multi-region disaster recovery
- continuous replication or streaming failover
- zero data loss
- any compliance certification
- a guaranteed production recovery-point or recovery-time objective
- protection against the failure of an entire cloud region or provider

Every figure the drill produces is named for what it is: a **measured prototype
recovery-point age** and a **measured prototype recovery duration**, taken
against local disposable infrastructure on one machine.

## Resilience service responsibility

`services/resilience` is loopback-bound on port 4106 with no browser CORS. It
owns the `aegis_resilience` database and `app` schema through its own
least-privilege role, and it records recovery **evidence**:

- which encrypted backup sets exist, by opaque identifier and checksum
- which drills ran, what state they reached, and what they measured
- an append-only event history for every drill
- per-service reconciliation results attached to a drill
- an operator acknowledgement for a failed drill

It stores no customer data, no balances, no credentials and no dump contents. A
backup file is referenced by identifier, checksum and byte count — never by
path, and never by its contents.

### What the service deliberately cannot do

There is no HTTP route that runs a backup, runs a restore, executes a shell
command, accepts a filesystem path, or accepts a database connection string.
Backup and restore are operator command-line tooling. An endpoint that shelled
out to `pg_dump` would be remote command execution behind a console login, and
no amount of authorization makes that a safe design.

The service never holds the backup encryption key. It validates at startup that
a usable key is configured and then records only the boolean
`backupKeyConfigured`; only the CLI tooling ever reads the key itself.

## Backup scope

Five service-owned PostgreSQL databases are in scope:

| Service    | Database           | Why it is authoritative              |
| ---------- | ------------------ | ------------------------------------ |
| identity   | `aegis_identity`   | user records, credentials, passkeys  |
| ledger     | `aegis_ledger`     | immutable journals and postings      |
| payments   | `aegis_payments`   | transfer lifecycle and idempotency   |
| risk       | `aegis_audit`      | security events, controls, incidents |
| resilience | `aegis_resilience` | recovery evidence itself             |

**Redis is deliberately out of scope.** It holds recreatable cache, replay and
velocity state — OTP challenges, session records, rate-limit counters, SABCL
replay claims — not authoritative balances or credential records. Backing it up
would preserve nothing a restore could not rebuild, while widening what a stolen
backup set exposes. After a restore, sessions are gone and customers sign in
again; that is the correct outcome, not a gap.

## Backup set layout

A set is a directory containing one encrypted file per service plus a manifest:

```text
backup_2026-08-01_a1b2c3d4/
  identity.dump.enc
  ledger.dump.enc
  payments.dump.enc
  risk.dump.enc
  resilience.dump.enc
  manifest.json
```

Each `.enc` file is a `pg_dump --format custom --no-owner --no-acl` output
encrypted with AES-256-GCM. The file layout is:

```text
magic "AEGISBK1" (8) ‖ version (1) ‖ nonce (12) ‖ tag (16) ‖ ciphertext
```

The header is authenticated as additional data, so a substituted version byte or
nonce fails the tag check rather than silently changing how the file is read.

A set is published **atomically**: everything is written to a staging directory
and renamed into place only once every dump has been taken, encrypted,
checksummed and listed. A reader therefore never sees a half-written set that
would restore an inconsistent platform.

## Isolated restore verification

`restore-verify.mjs` proves a set is usable without touching anything live:

1. Parse and validate the manifest — schema, safe file names, known services,
   complete coverage.
2. Verify every file's SHA-256 **before decrypting anything**, so a corrupted
   set is rejected without the key being applied to it.
3. Decrypt each file, which also proves the key is right and the ciphertext
   authentic.
4. Create a freshly named disposable database per service,
   `aegis_verify_<service>_<random>`, checked against the live database names.
5. `pg_restore --no-owner --no-acl --exit-on-error` into it.
6. Assert the restored database actually contains application tables, not merely
   that it exists.
7. Drop every database it created and remove all decrypted material, in
   `finally`, whether the run passed or failed.

The default path has no flag, no environment variable and no argument that can
redirect a restore onto a live database. Overwriting an active service database
is not a supported operation of this tool.

## Drill state machine

```text
PLANNED → RUNNING → BACKUP_CREATED → RESTORE_VERIFIED
        → RECONCILIATION_PASSED → PASSED → CLEANED_UP

any state → FAILED → CLEANED_UP
```

Transitions are validated in the service. A drill cannot jump from `PLANNED` to
`PASSED`, because that would record a successful recovery that never restored
anything. An out-of-order or terminal move is a `409`, never a silent overwrite.

Drill events and reconciliation results are append-only, enforced by PL/pgSQL
triggers rather than by convention. The fields that identify a backup set — its
identifier, checksum, creation time, service list and size — are immutable;
`verified` is the only field a later restore may set.

## Recovery readiness and the console

`GET /internal/v1/readiness` returns one validated document: platform state,
per-dependency health, the latest backup set summary, and the latest drill. The
Gateway exposes it to signed-in security operators at
`/api/v1/security-ops/resilience/readiness`, and the console renders it at
`/security-ops/resilience`.

Dependency probes are bounded and their failures fold into a state rather than
propagating, so one unreachable service degrades the report instead of failing
it. Nothing in the document reveals how to reach anything: no database URL, no
host, no token, no stack trace. A dependency is a name, a kind and a state.

## Data flow

```text
Operator CLI ──► pg_dump ──► AES-256-GCM ──► backup set on disk
      │
      └──► POST /internal/v1/backup-sets        (identifier, checksum, size)
      └──► POST /internal/v1/drills/:id/advance (state, measurements)

Operator CLI ──► manifest + checksum + decrypt ──► disposable databases
      │                                                   │
      └──► pg_restore ──────────────────────────────────► │
                                                          └──► dropped

Browser ──► Gateway /api/v1/security-ops/resilience/* ──► Resilience :4106
             (operator session validated by Risk,          (gateway source token)
              CSRF on every mutation)
```

The browser never reaches the Resilience service directly, and the Resilience
service never reaches a customer-facing surface.

## Related documents

- [ADR 0011](../decisions/0011-operational-resilience-and-dr.md)
- [Backup encryption and key management](../security/backup-encryption-and-key-management.md)
- [Disaster-recovery threat model](../security/disaster-recovery-threat-model.md)
- [Recovery operator authorization](../security/recovery-operator-authorization.md)
- [Backup retention and disposal](../security/backup-retention-and-disposal.md)
- [Disaster-recovery runbook](../operations/disaster-recovery-runbook.md)
- [Service failure runbook](../operations/service-failure-runbook.md)
- [Backup and restore runbook](../operations/backup-restore-runbook.md)
