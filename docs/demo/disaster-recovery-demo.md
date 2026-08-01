# Disaster recovery demo

Roughly twelve minutes. Use synthetic data only. Everything shown is a prototype
drill against local disposable infrastructure — no multi-region failover, no
continuous replication, no zero data loss and no compliance claim.

## Setup

1. Copy `.env.example` to `.env` and set real local values, including a generated
   backup key:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

   Put it in `DR_BACKUP_ENCRYPTION_KEY`. Do not use the placeholder; it is
   deliberately not a valid key.

2. `pnpm infra:up && pnpm infra:check` — five databases and five roles, including
   `aegis_resilience`.
3. `pnpm db:deploy` — all five migration sets.
4. `pnpm build && pnpm stack` — Web 3000, Gateway 4000, Identity 4101,
   Ledger 4102, Payments 4104, Risk 4105, Resilience 4106.
5. Confirm `pg_dump --version` is at least 17. An older client refuses to dump a
   newer server; that refusal is correct.

## 1. Produce data worth recovering (2 min)

Sign in as a customer, complete one transfer, and view the transaction history.
The point is that the ledger now contains a posting whose survival can be
demonstrated.

## 2. Create an encrypted backup set (2 min)

```bash
pnpm dr:backup
```

Show the set on disk:

```bash
ls .dr-backups/backup_*/
```

Five `.enc` files and a `manifest.json`. Then show that a dump is not readable:

```bash
head -c 16 .dr-backups/backup_*/ledger.dump.enc | xxd
```

The first eight bytes are the magic `AEGISBK1`; everything after the header is
ciphertext. There is no plaintext `PGDMP` header, because the plaintext was
removed in the same loop iteration that produced it.

## 3. Verify without restoring (1 min)

```bash
pnpm dr:backup:verify
```

Checksums are verified against the ciphertext before anything is decrypted, so a
corrupted set is rejected without the key ever touching it.

## 4. Show the refusals (2 min)

```bash
pnpm dr:backup:verify:negative
```

Nine copies of the real set, each broken differently — wrong key, flipped byte,
missing file, missing service, duplicate service, a path in a file name, an
unsupported manifest version, an unsupported algorithm, a symlink pointing out of
the directory — and every one refused. The original set is untouched.

This is the part worth dwelling on: a backup set is attacker-influenced input the
moment it lives on shared storage.

## 5. Restore into disposable databases (2 min)

```bash
pnpm dr:restore:verify
```

Point out in the output:

- the target databases are generated names, `aegis_verify_<service>_<random>`
- they are checked against the live database names before anything is written
- the restored databases are asserted to contain application tables, not merely
  to exist
- they are dropped, and decrypted material removed, in `finally`

Then show the measurements, and name them accurately: **measured prototype
recovery-point age** and **measured prototype recovery duration**. They are not
an RPO or an RTO.

## 6. Run the full drill (2 min)

```bash
pnpm dr:drill
```

Backup → verify → isolated restore → four reconciliations → `PASSED` →
`CLEANED_UP`, with every step recorded in the append-only drill history.

## 7. Read the console (2 min)

Sign in at `/security-ops/sign-in`, then open `/security-ops/resilience`.

- Platform state and per-dependency health, in words as well as colour.
- The latest backup set: identifier, databases covered, algorithm, abbreviated
  checksum, encrypted size, and whether a restore has ever verified it.
- The drill history, newest first, with both measurements.

Then show what is **not** there: no button that runs a backup or a restore, no
file path, no database URL, no key. The page says where that work actually
happens — operator command-line tooling.

## 8. Demonstrate a controlled failure (1 min)

Stop the Risk service and refresh the console. Platform state becomes `DEGRADED`
and Risk reads `UNAVAILABLE`; nothing hangs and no address is disclosed. Restart
Risk and refresh again: `HEALTHY` on the very next call, with no restart of the
Resilience service and no cached verdict to clear.

To show an acknowledged failure, record a drill and advance it to `FAILED`
through the tooling, then acknowledge it in the console with a reason. The
acknowledgement is attributed to the signed-in operator, permanent, and possible
exactly once.

## 9. Prove the evidence cannot be rewritten (1 min)

```bash
pnpm resilience:reconcile
```

Then, in `psql`, attempt to rewrite history:

```sql
UPDATE app.drill_events SET note = 'rewritten' WHERE state = 'PLANNED';
```

PostgreSQL raises `resilience drill history is append-only`. The same happens for
`DELETE`, and for any change to a backup set's identifier, checksum, creation
time, service list or size.

## Teardown

```bash
rm -rf .dr-backups
pnpm infra:down
```

Delete the backup sets. A set is customer data under a key; do not leave demo
sets lying around, and never commit one.

The browser test `apps/web/e2e/resilience.spec.ts` automates the console
journey, the acknowledgement, the mobile layout check and the axe pass.
