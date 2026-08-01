# Disaster-recovery threat model

Recovery tooling is an unusually attractive target: it reads every authoritative
database, it holds a key that opens all of them, and it runs with enough
privilege to create and drop databases. A weakness here is a weakness in every
other boundary at once.

## Assets

| Asset                      | Why it matters                                        |
| -------------------------- | ----------------------------------------------------- |
| Backup set contents        | Hashed PINs, passkeys, ledger, transfers, audit trail |
| `DR_BACKUP_ENCRYPTION_KEY` | Opens every backup set                                |
| Database credentials       | Direct read of live authoritative data                |
| Administrative connection  | Can create and drop databases                         |
| Recovery evidence          | What an auditor relies on after an incident           |
| Operator session           | Reaches the recovery console                          |

## Trust boundaries

```text
Browser  ──►  Gateway :4000  ──►  Resilience :4106  ──►  aegis_resilience
   untrusted     trusted            trusted, evidence only

Operator shell  ──►  DR CLI  ──►  pg_dump / pg_restore / psql  ──►  all databases
   trusted host        holds the key, never reachable over HTTP
```

The CLI is the only component that holds the backup key or touches dumps. The
service is on the network but holds neither. That split is the central control:
compromising the HTTP surface does not yield the key or the data.

## Threats and controls

### T1 — Remote command execution through a recovery endpoint

**Threat.** An attacker reaches an HTTP route that runs a backup or restore and
supplies a crafted path, connection string or option to execute code.

**Control.** No such route exists. The Resilience service has no endpoint that
runs a backup, runs a restore, accepts a filesystem path, accepts a database
connection string or executes a shell command. Backup and restore are CLI only.
Every child process the CLI spawns is invoked with an argument array, never a
shell string, so no value can be reinterpreted as shell syntax. The
`x-aegis-source-token` guard sits in front of every internal route.

### T2 — Stolen backup file

**Threat.** A backup file is copied off the machine, from shared storage or from
a CI artifact.

**Control.** Files are AES-256-GCM encrypted before they are written, and the
plaintext dump is removed within the same loop iteration that produced it. The
key lives only in the operator environment. CI never uploads dumps, decrypted
files, database logs, `.env`, tokens or keys; a dedicated CI step removes the
backup working directory and fails the job if a `.dump` file survived.

**Residual risk.** An attacker who obtains both a set and the key reads
everything. Key custody is the mitigation and is operational work outside this
repository.

### T3 — Restore over a live database

**Threat.** A restore is pointed at `aegis_ledger` and destroys production data,
by accident or by an attacker supplying a target.

**Control.** Every restore target is a database created by the tool with a
generated name, `aegis_verify_<service>_<random>`, validated against
`^[a-z0-9_]{1,63}$` and checked against the set of live database names before a
byte is written. There is no flag, environment variable or argument that
redirects a restore onto an existing database. Created databases are dropped in
`finally`, and a cleanup failure sets a non-zero exit code rather than being
swallowed.

### T4 — Tampered or substituted backup set

**Threat.** An attacker with write access to the backup directory alters a
ciphertext, swaps a file, or edits the manifest, so a later restore rebuilds a
platform of their choosing.

**Control.** The manifest is parsed against a strict schema. File names must be
plain names — no path component, no leading dot, no traversal — and the check
runs before any name is joined to a directory. Symbolic links and directories
masquerading as files are refused. Each file's SHA-256 is verified against the
manifest before decryption, and GCM authentication then proves the ciphertext is
genuine under the real key. Sizes must match. A set missing any service in scope
is rejected as incomplete rather than restored partially. CI exercises every one
of these refusals against a set that `pg_dump` actually produced.

**Residual risk.** The manifest is not signed, so an attacker with write access
can still delete sets or plant a self-consistent set of their own — one that will
not decrypt under the real key. Immutable offsite storage and manifest signing
are the mitigations and are not implemented here.

### T5 — Falsified recovery evidence

**Threat.** A drill is recorded as passed although no restore was verified, so an
operator believes recovery works when it does not.

**Control.** The drill state machine refuses out-of-order transitions: `PLANNED`
cannot become `PASSED`. Drill events and reconciliation results are append-only,
enforced by PL/pgSQL triggers. Backup-set identity fields are immutable; only
`verified` may change. Evidence reconciliation flags a passed drill with no
restore evidence, no reconciliation or no backup set as a CRITICAL finding. A
failure code may only exist on a failed drill, enforced by a CHECK constraint.

### T6 — Disclosure through the console or logs

**Threat.** A connection string, password, token, key, dump path or customer
reference reaches an operator's browser, a CI log or a stack trace.

**Control.** Contracts are `.strict()` in both directions: the Resilience service
emits only documented fields, and the Gateway re-validates every response before
it leaves for the browser, so a field added upstream cannot silently reach a
page. Readiness reports a dependency as a name, a kind and a state — never a URL.
Health responses report `backupKeyConfigured` as a boolean. CLI logs are bounded
and redacted, with credentials stripped from URLs and `password=` parameters.
Child-process stderr is capped at 8 KB and redacted before it can be printed.
Tests assert the absence of `postgresql://`, passwords, tokens, keys and `.dump`
in console markup, health output and drill evidence.

### T7 — Unauthorized access to the recovery console

**Threat.** An unauthenticated visitor, a customer session, or a non-operator
role reads recovery evidence or acknowledges a failure.

**Control.** See
[recovery operator authorization](./recovery-operator-authorization.md). Every
route validates the operator session against Risk before contacting Resilience,
requires the `SECURITY_OPERATOR` role, and requires a double-submit CSRF token on
every mutation. The acknowledging operator is taken from the validated session,
never from the request body.

### T8 — Credentials on the process table

**Threat.** A database password passed on a command line is visible to any local
user through `ps`.

**Control.** `pg_dump`, `pg_restore` and `psql` receive the password through
`PGPASSWORD` in the child environment, never as an argument.

### T9 — Denial of service through the console

**Threat.** Repeated readiness requests fan out to every dependency and exhaust
the service or its upstreams.

**Control.** Readiness probes are bounded by an explicit timeout, run
concurrently rather than serially, drain their bodies and close their
connections. `/api/v1/security-ops/*` is behind the Gateway's rate-limit
middleware. Drill history is cursor-paginated with a bounded page size, enforced
identically at the Gateway and the service.

## Explicitly out of scope

This prototype does not defend against, and does not claim to survive:

- loss of an entire cloud region or provider
- a compromised operator workstation that already holds the key
- an attacker with write access to immutable offsite storage, because there is
  no offsite storage here
- long-term key custody failure

## Related documents

- [Backup encryption and key management](./backup-encryption-and-key-management.md)
- [Recovery operator authorization](./recovery-operator-authorization.md)
- [Backup retention and disposal](./backup-retention-and-disposal.md)
- [Operational resilience and DR architecture](../architecture/operational-resilience-and-dr.md)
