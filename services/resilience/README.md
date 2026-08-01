# Resilience service

`@aegis/resilience-service` owns recovery **evidence**: which encrypted backup
sets exist, which recovery drills ran, what they measured, and what an operator
said about a failure. It listens on loopback port `4106` in local development and
owns the `aegis_resilience` database through its own least-privilege role. It
never reads or writes the Identity, Ledger, Payments or Risk databases.

## What it deliberately cannot do

There is no HTTP route that runs a backup, runs a restore, executes a shell
command, accepts a filesystem path, or accepts a database connection string.
Backup and restore are operator command-line tooling. An endpoint that shelled
out to `pg_dump` would be remote command execution behind a console login, and no
amount of authorization makes that a safe design.

The service never holds the backup encryption key. It validates at startup that
one is configured and parses to 32 usable bytes, then records only
`backupKeyConfigured: true`. Only the CLI reads the key itself.

## Trust boundaries

- Every route except `/health/live` and `/health/ready` requires either
  `RESILIENCE_INTERNAL_TOKEN` in `x-aegis-internal-token` or a per-source token
  in `x-aegis-source-token`. Comparisons are constant-time and every failure
  returns the same `401`.
- The Gateway holds `RESILIENCE_GATEWAY_SOURCE_TOKEN`, the DR CLI holds
  `RESILIENCE_TOOLING_SOURCE_TOKEN`. A leaked gateway token cannot be replayed as
  operator tooling.
- Browser access goes through `/api/v1/security-ops/resilience/*`, where the
  Gateway validates the operator session against Risk, requires the
  `SECURITY_OPERATOR` role, and requires double-submit CSRF on every mutation.
- Contracts are strict in both directions. The Gateway re-validates every
  response before it leaves for a browser, so a field added upstream cannot
  silently reach a page.

## State

PostgreSQL stores backup-set summaries, recovery drills, an append-only drill
event history and per-service reconciliation results. Drill history and
reconciliation results are append-only, enforced by PL/pgSQL triggers. A backup
set's identifier, checksum, creation time, service list and size are immutable;
`verified` is the only field a later restore may set.

No customer data, no balances, no credentials, no dump contents and no file paths
are stored. A backup file is referenced by opaque identifier and checksum only.

## Drill state machine

```text
PLANNED → RUNNING → BACKUP_CREATED → RESTORE_VERIFIED
        → RECONCILIATION_PASSED → PASSED → CLEANED_UP
any state → FAILED → CLEANED_UP
```

Out-of-order and terminal transitions are a `409`. A drill cannot jump from
`PLANNED` to `PASSED`, because that would record a successful recovery that never
restored anything.

## Commands

```text
pnpm db:deploy:resilience
pnpm resilience:test
pnpm resilience:test:integration
pnpm resilience:reconcile

pnpm dr:backup
pnpm dr:backup:verify
pnpm dr:backup:verify:negative
pnpm dr:restore:verify
pnpm dr:drill
```

Integration and DR commands require PostgreSQL, `pg_dump`/`pg_restore`/`psql` at
least as new as the server, and the environment values documented in
`.env.example` — including `DR_BACKUP_ENCRYPTION_KEY`.

`reconcile` fails when the evidence is internally inconsistent: a drill with no
history, or a passed drill with no restore evidence, no reconciliation or no
backup set. Unacknowledged failures, stuck drills and unverified sets are
reported as warnings.

## Honest limitation

This is a prototype. It demonstrates encrypted capture, verified restore into
disposable databases, and auditable drill evidence on one machine. It provides no
production multi-region disaster recovery, no continuous replication, no zero
data loss, no compliance certification and no guaranteed recovery-point or
recovery-time objective. Drill figures are a **measured prototype recovery-point
age** and a **measured prototype recovery duration**, nothing more. Backup key
custody, offsite immutable storage, retention enforcement and key rotation with
re-encryption remain operational work outside this repository.

See [operational resilience and DR](../../docs/architecture/operational-resilience-and-dr.md)
and [ADR 0011](../../docs/decisions/0011-operational-resilience-and-dr.md).
