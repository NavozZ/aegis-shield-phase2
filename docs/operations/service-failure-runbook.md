# Service failure runbook

How the platform behaves when one part of it is unavailable, and what an operator
should do about it. Nothing here involves restoring data — that is the
[disaster-recovery runbook](./disaster-recovery-runbook.md).

## Reading the readiness document

`/security-ops/resilience` shows a platform state derived from two things: can
the Resilience service reach its own database, and can it reach each dependency.

| Platform state | Meaning                                          |
| -------------- | ------------------------------------------------ |
| `HEALTHY`      | database reachable, every dependency answering   |
| `DEGRADED`     | database reachable, at least one dependency down |
| `UNAVAILABLE`  | the Resilience database itself is unreachable    |

Each dependency is reported as a name, a kind and a state. There is deliberately
no URL, host or port in the document: an operator needs to know _that_ Risk is
unreachable, not the address at which it is not answering.

Probes are bounded by an explicit timeout and run concurrently, so one stalled
dependency degrades the report within its budget rather than serialising the
others or hanging the page. There is no cached verdict and no backoff state:
refreshing shows current reality, and a dependency that recovers reads healthy on
the very next call with no restart.

## Failure policy by service

### Risk unavailable

Sensitive transfers fail closed — this is the established threat-detection behaviour and
is unchanged. Telemetry is fail-open.

For the recovery console specifically, Risk is the operator session authority, so
its outage means nobody can sign in to the console. The Gateway returns
`OPERATOR_UNAUTHORIZED` and the browser is redirected to sign-in. Recovery
evidence is unaffected; it simply cannot be read until Risk is back.

**Action.** Restart Risk. The DR tooling does not depend on it except for
`risk:reconcile` during a drill.

### SABCL strict mode with the router unavailable

An outage, never a plaintext retry. Gateway calls that route through SABCL fail
rather than falling back to a direct call. The Resilience service has no SABCL
route at all, so recovery readiness is unaffected.

**Action.** Restart the router. Do not switch `SABCL_MODE` to `off` to work
around it in an environment where strict mode was chosen deliberately.

### Payments or Ledger unavailable

Transfers stop. Readiness reports the service `UNAVAILABLE` with failure code
`DEPENDENCY_UNAVAILABLE`, and the platform state becomes `DEGRADED`.

**Action.** Restart the service, then run its reconciliation before considering
the incident closed:

```bash
pnpm ledger:reconcile
pnpm payments:reconcile
```

A transfer left `PROCESSING` across a restart is resolved by the existing
payments recovery path, not by a database restore.

### Redis unavailable

Sessions, OTP challenges, rate-limit counters, velocity windows and SABCL replay
claims are all in Redis. Its loss logs everyone out and resets counters. No
authoritative data is lost, because none is stored there — which is exactly why
Redis is not in the backup scope.

**Action.** Restart Redis. Customers sign in again. Do not attempt to "restore"
Redis; there is nothing to restore and nothing was lost.

### Resilience unavailable

The recovery console shows an unavailable message. Backup and restore tooling
continues to work — it writes files and talks to PostgreSQL directly — but a
drill cannot record its progress, so `pnpm dr:drill` fails at the first post
rather than running unrecorded. That is deliberate: an unrecorded drill proves
nothing to anyone reading the evidence later.

**Action.** Restart the service. If it refuses to start, the message names the
missing configuration. It refuses to start on a placeholder token in production
or an unusable `DR_BACKUP_ENCRYPTION_KEY`, because a service that came up
degraded would report a recovery readiness it cannot support.

### The Resilience database unavailable

Platform state is `UNAVAILABLE` and `/health/ready` reports `degraded` with
`database: unavailable`. `/health/live` still answers, because the process is
running — distinguishing "alive" from "able to do its job" is the point of having
both.

**Action.** Check PostgreSQL: `pnpm infra:check`.

## Restart behaviour

Application services are stateless with respect to recovery evidence. Restarting
one loses nothing: drills and backup sets are in PostgreSQL, and the state
machine refuses to re-enter a state it has already passed, so a restarted tool
cannot double-record a step.

A drill interrupted mid-flight leaves its record in `RUNNING`,
`BACKUP_CREATED` or `RESTORE_VERIFIED`. Evidence reconciliation reports this as
`DRILL_STUCK_IN_PROGRESS`, a warning: it means tooling died without recording an
outcome, and the drill should be re-run rather than resumed.

## Recovering from a degraded state

1. `pnpm infra:up && pnpm infra:check` — PostgreSQL and Redis first.
2. Restart the application services, or `pnpm stack` for all of them.
3. Refresh `/security-ops/resilience` and confirm the platform state.
4. Run the reconciliations for any service that was down.
5. If a drill is stuck, re-run it: `pnpm dr:drill`.

## Evidence reconciliation findings

`pnpm resilience:reconcile` checks that the recovery evidence is internally
consistent. It does not re-verify backups — that needs the key and is the
tooling's job.

| Finding                           | Severity | Meaning                                 |
| --------------------------------- | -------- | --------------------------------------- |
| `DRILL_WITHOUT_HISTORY`           | CRITICAL | a drill with no events; unauditable     |
| `PASSED_WITHOUT_RESTORE_EVIDENCE` | CRITICAL | passed without a verified restore       |
| `PASSED_WITHOUT_RECONCILIATION`   | CRITICAL | passed without a passing reconciliation |
| `PASSED_WITHOUT_BACKUP_SET`       | CRITICAL | passed without naming a set             |
| `UNACKNOWLEDGED_FAILED_DRILL`     | WARNING  | a failure nobody has reviewed           |
| `DRILL_STUCK_IN_PROGRESS`         | WARNING  | tooling died mid-drill                  |
| `UNVERIFIED_BACKUP_SET`           | WARNING  | a set no restore has ever proved usable |

Warnings are reported but do not fail the run. Any CRITICAL finding fails it, and
means the evidence itself cannot be trusted — investigate before relying on any
drill result.

## Related documents

- [Disaster-recovery runbook](./disaster-recovery-runbook.md)
- [Backup and restore runbook](./backup-restore-runbook.md)
- [Risk failure policy](../security/risk-failure-policy.md)
- [Incident response runbook](../security/incident-response-runbook.md)
