# Disaster-recovery runbook

What to do when data has been lost or corrupted, and how to rehearse it before
that happens.

This is a prototype procedure against local disposable infrastructure. It is not
a production disaster-recovery plan: there is no multi-region failover, no
continuous replication, no zero-data-loss property and no compliance
certification behind it.

## Rehearsal: run a drill

```bash
pnpm infra:up && pnpm infra:check
pnpm db:deploy

# Start the services the drill reports to.
pnpm --filter @aegis/risk-service build && (cd services/risk && node dist/main.js) &
pnpm --filter @aegis/resilience-service build && (cd services/resilience && node dist/main.js) &

pnpm dr:drill
```

The drill runs, in order:

1. Record a `CI_AUTOMATED` drill in state `PLANNED`, then `RUNNING`.
2. `pnpm dr:backup` — encrypted set of all five databases.
3. Register the set and advance to `BACKUP_CREATED`.
4. `pnpm dr:backup:verify` — checksums and authenticity, no restore.
5. `pnpm dr:restore:verify` — isolated restore into disposable databases; record
   the measured prototype recovery-point age and recovery duration; advance to
   `RESTORE_VERIFIED`.
6. Four reconciliations — Ledger, Payments, Risk, Resilience; advance to
   `RECONCILIATION_PASSED`.
7. `PASSED`, then `CLEANED_UP`.

Any failure records the drill as `FAILED` with a failure code, so it appears in
the console for acknowledgement rather than vanishing with the terminal. The
drill fails loudly on a missing dump, a checksum mismatch, tampered ciphertext, a
wrong key, an absent service, a failed reconciliation or a failed cleanup —
because those are exactly the conditions under which a real recovery would not
work.

Read the result at `/security-ops/resilience`, or:

```bash
pnpm resilience:reconcile
```

## Real recovery

### 1. Stop the bleeding

Before restoring anything, stop what is still writing. Apply Risk controls to
suspend the affected operations, or stop the application services. A restore
performed while traffic continues produces a database that matches neither the
backup nor the live state.

### 2. Establish what was lost

Read the console at `/security-ops/resilience`:

- **Latest backup set** — when it was taken, and whether `Restore verified` is
  `Yes`. A set showing `No` has never been proved usable.
- **Latest drill** — the measured prototype recovery-point age from the last
  drill is the best available estimate of how much recent work a restore from
  that set would discard.
- **Dependency state** — which services are reachable at all.

Everything written after the set was taken is gone if you restore from it. Decide
whether that is better than the current state before continuing.

### 3. Verify before you destroy

```bash
pnpm dr:backup:verify
pnpm dr:restore:verify
```

Never drop a live database before proving the set you intend to restore actually
restores. A corrupt set discovered after the live data is gone is the worst
possible ordering.

### 4. Back up the broken state

Take a fresh set of the current, damaged databases:

```bash
pnpm dr:backup
```

It is the only way back from a mistaken restore, and it preserves forensic
evidence of whatever caused the incident.

### 5. Restore

Restoring into live service databases is manual and deliberate — the tooling
provides no automated path to it. Follow
[backup and restore runbook](./backup-restore-runbook.md), "Restoring for real".

Restore all five databases from the **same set**. Restoring the ledger from one
set and payments from another produces transfers referring to postings that do
not exist.

### 6. Reconcile before letting traffic in

```bash
pnpm ledger:reconcile
pnpm payments:reconcile
pnpm risk:reconcile          # requires the Risk service running
pnpm resilience:reconcile    # requires the Resilience service running
```

All four must pass. A ledger that does not reconcile after a restore is not a
recovered ledger.

### 7. Expect sessions to be gone

Redis is deliberately not backed up. After a restore, every session, OTP
challenge, rate-limit counter and SABCL replay claim is absent. Customers sign in
again. That is the correct outcome: those are recreatable, and preserving them
would widen what a stolen backup exposes.

### 8. Record what happened

Acknowledge the failed drill in the console with a reason, if one was recorded.
Acknowledgement is permanent, attributed to the signed-in operator, and can be
done once — so write the reason for the next person reading it, not for the
ticket.

## Partial failures

| Situation                                     | Action                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| One service's database is corrupt             | Restore all five from one set anyway; cross-service references will not survive a partial restore |
| A backup file fails its checksum              | The whole set is unusable. Use the previous verified set                                          |
| The key does not decrypt a set                | The set was encrypted under a different key. Do not delete it; find the right key                 |
| A drill fails at `RESTORE_FAILED`             | The set may still be intact. Check disk space and the client version first                        |
| Cleanup failed, verification databases remain | Drop them by hand: they are full copies of service data with no application in front              |

## Related documents

- [Backup and restore runbook](./backup-restore-runbook.md)
- [Service failure runbook](./service-failure-runbook.md)
- [Operational resilience and DR architecture](../architecture/operational-resilience-and-dr.md)
- [Disaster-recovery threat model](../security/disaster-recovery-threat-model.md)
- [Incident response runbook](../security/incident-response-runbook.md)
