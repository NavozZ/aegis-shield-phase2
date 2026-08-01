# ADR 0011: Operational resilience, encrypted backup and disaster recovery

## Decision

Create an independent Resilience service on reserved port 4106 with its own
`aegis_resilience` database and least-privilege role. The service records
recovery **evidence** only: backup-set identifiers and checksums, drill state
with a validated transition machine, append-only drill history and
reconciliation results, and operator acknowledgements.

Backup and restore remain operator command-line tooling. There is no HTTP route
that runs `pg_dump` or `pg_restore`, accepts a filesystem path, accepts a
database connection string, or executes a shell command. Encrypt backup files
with AES-256-GCM using Node's maintained primitives and a raw 256-bit key read
from the environment by the CLI alone; the service validates that a key is
configured and stores only that boolean.

Verify restores into freshly named disposable databases that are checked against
the live database names and dropped afterwards, never over an active service
database. Back up the five authoritative PostgreSQL databases and deliberately
not Redis, whose cache, replay and velocity state is recreatable.

Expose readiness and drill history to signed-in security operators through the
existing Risk-owned operator session, with CSRF on every mutation, at
`/security-ops/resilience`.

## Consequences

Recovery evidence is auditable and hard to falsify: append-only triggers and a
validated state machine mean a drill cannot claim a restore it never performed,
and immutable backup-set identity fields mean a substituted set cannot inherit
another set's verification. Checksums are verified before decryption, so
corruption is rejected without the key touching the bytes.

Keeping execution in the CLI costs convenience — an operator cannot start a
drill from the browser, only record that one is planned — and that is the
intended trade: a console button that shells out is remote command execution
behind a login. Excluding Redis means sessions do not survive a restore and
customers sign in again.

The measurements a drill produces are prototype figures from local disposable
infrastructure. They are named `measuredRecoveryPointAgeSeconds` and
`measuredRecoveryDurationMs` rather than RPO and RTO, because this prototype
provides no production recovery objective, no continuous replication, no
multi-region disaster recovery, no zero-data-loss property and no compliance
certification. Backup encryption key custody, offsite storage, retention
enforcement and key rotation with re-encryption remain operational work outside
this repository.
