# Ledger integrity model

This document explains how AEGIS Shield guarantees that a customer balance always follows from an immutable, balanced record. It covers accounts, journals, postings, balances and reconciliation.

## Debit and credit rules

AEGIS uses standard double-entry accounting. Every journal entry contains two or more postings, each carrying a strictly positive `amountMinor` and a `direction` of `DEBIT` or `CREDIT`. The sign lives in the direction, never in the amount.

A journal is valid only when all of the following hold:

- `sum(DEBIT amounts) = sum(CREDIT amounts)`
- at least two postings exist
- every posting amount is greater than zero
- every posting uses the journal's currency
- every referenced ledger account uses that same currency

### Account classes

| Class     | Normal balance | Balance                    | Increased by |
| --------- | -------------- | -------------------------- | ------------ |
| ASSET     | DEBIT          | `debitTotal - creditTotal` | DEBIT        |
| EXPENSE   | DEBIT          | `debitTotal - creditTotal` | DEBIT        |
| LIABILITY | CREDIT         | `creditTotal - debitTotal` | CREDIT       |
| EQUITY    | CREDIT         | `creditTotal - debitTotal` | CREDIT       |
| REVENUE   | CREDIT         | `creditTotal - debitTotal` | CREDIT       |

A **customer wallet is a LIABILITY**: the balance is money the platform owes the customer. Crediting a wallet increases what the customer can see and spend; debiting it decreases that amount. A database `CHECK` constraint keeps `account_class` and `normal_balance` consistent, so a wallet cannot be mislabelled as an asset.

## Money representation

Money is an integer count of minor units end to end:

| Layer            | Representation                        |
| ---------------- | ------------------------------------- |
| PostgreSQL       | `BIGINT`                              |
| Ledger service   | `BigInt`                              |
| Contracts / JSON | decimal string, e.g. `"125000"`       |
| Browser display  | formatted string, e.g. `LKR 1,250.00` |

No JavaScript `number` and no floating-point column ever holds an amount. Formatting for display is done by string manipulation, so a value larger than `Number.MAX_SAFE_INTEGER` still renders exactly.

## Append-only guarantees

Posted journal entries and postings are immutable. `BEFORE UPDATE OR DELETE` triggers on `app.journal_entries` and `app.journal_postings` raise an exception for every mutation attempt, regardless of whether it comes from the service, a migration, or a direct `psql` session.

The application never issues an UPDATE or DELETE against these tables, and there is no API route — internal or browser-facing — that edits or removes a journal. Corrections are made by posting a reversing entry, which preserves the original record.

## Database-level protections

TypeScript validation runs first so callers get a useful error, but it is not the guarantee. The authoritative rules live in the database:

**Value constraints**

- `journal_postings_amount_minor_positive`: `amount_minor > 0`
- `journal_postings_sequence_range`: `0 <= sequence < 32`
- currency format checks (`^[A-Z]{3}$`) on ledger accounts, customer accounts, journals and postings
- public and masked account reference format checks
- `balance_projections_totals_non_negative` and a non-negative version
- `ledger_accounts_normal_balance_matches_class`

**Uniqueness**

- one journal reference, one ledger account code, one system account per type
- one default account per `(customer_id, product_type, currency)`
- one posting per `(journal_entry_id, sequence)`
- one idempotency record per `(scope, key_hash)`

**Deferred integrity**

Postings are inserted after their journal entry, so the balance rule can only be judged once the whole transaction is assembled. Two `CONSTRAINT TRIGGER`s declared `DEFERRABLE INITIALLY DEFERRED` run at COMMIT and reject an entry that is unbalanced, has fewer than two postings, mixes currencies, or posts to an account in another currency. A transaction that reaches COMMIT with a broken journal fails; it does not persist.

**Structural invariants**

An `AFTER INSERT` trigger on `app.ledger_accounts` creates the matching `balance_projections` row, so an account that can receive postings always has a projection. Foreign keys use `RESTRICT` for financial rows, so a referenced account or journal cannot be deleted out from under a posting.

## Balance calculation

`BalanceProjection` stores `debitTotalMinor`, `creditTotalMinor` and a `version`, updated in the same transaction as the postings that changed them. It is a cache for reads.

The **authoritative** balance is always:

```sql
SELECT
  SUM(CASE WHEN direction = 'DEBIT'  THEN amount_minor ELSE 0 END) AS debit_total,
  SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE 0 END) AS credit_total
FROM app.journal_postings
WHERE ledger_account_id = $1;
```

applied to the account-class formula above. Because postings are immutable, this recomputation is stable and repeatable.

## Insufficient-funds enforcement

Before writing anything, the service projects the post-transaction totals for every affected account and computes the resulting signed balance. If any account would fall below zero and its `allow_negative_balance` flag is false, the whole journal is rejected with `INSUFFICIENT_FUNDS` and nothing is written.

`allow_negative_balance` is true only for explicitly configured system accounts, which represent platform positions. Customer wallets are always created with it false. A debit exactly equal to the available balance is permitted; one minor unit more is not.

## Deterministic locking

Journal posting locks every affected ledger account and its balance projection in a single statement:

```sql
SELECT ... FROM app.ledger_accounts AS account
JOIN app.balance_projections AS projection ON projection.ledger_account_id = account.id
WHERE account.id = ANY($1::uuid[])
ORDER BY account.id
FOR UPDATE OF account, projection
```

Two properties matter:

1. **Ascending identifier order.** Every caller locks in the same order, so two journals touching the same pair of accounts cannot each hold what the other needs. Deadlock is avoided by construction rather than by retry.
2. **Locks held to COMMIT.** The balance is read, the sufficiency check is made, and the projection is written while the rows are locked, so two concurrent debits cannot both observe the same starting balance.

Account provisioning takes `pg_advisory_xact_lock` on a key derived from customer, product and currency, which serialises the read-then-create path for one logical account without blocking unrelated work. No in-memory mutex is used: it would not hold across processes or replicas.

## Idempotency conflicts

Each state-changing operation carries an `Idempotency-Key`, deliberately distinct from the correlation ID so a retry keeps its key while getting a fresh trace.

Stored per record: the operation scope, a SHA-256 hash of the key, a SHA-256 hash of the canonical request payload, the status, and the stored response. The raw key and raw payload are never persisted.

| Situation                                     | Result                                                          |
| --------------------------------------------- | --------------------------------------------------------------- |
| New key                                       | Work executes once; response stored.                            |
| Same key, same payload                        | Stored response replayed.                                       |
| Same key, different payload                   | `409 IDEMPOTENCY_CONFLICT`.                                     |
| Same key, concurrent, first not yet committed | Blocks on the unique index, then replays the winner's response. |

Canonicalisation sorts object keys and drops undefined values, so an equivalent request always hashes identically. Array order is significant. Logs contain only `idem:` plus a 12-character non-reversible fingerprint, so a leaked log cannot be used to replay a request.

## Auditability

Every journal entry records its `correlationId`, `effectiveAt`, `createdAt`, `createdByType` and `createdById`, plus bounded metadata. Because entries and postings are immutable, the sequence of postings is a complete and permanent audit trail of how each balance was reached.

Reconciliation runs are themselves recorded in `app.reconciliation_runs` with start and completion times, counts, status and bounded issue detail, giving an audit trail of the checking itself.

## Recovery from projection mismatch

Reconciliation compares each `BalanceProjection` against totals recomputed from the postings and reports `BALANCE_PROJECTION_DRIFT` with the affected account code.

Because the postings are immutable and authoritative, recovery does not require reversing customer activity:

1. Run reconciliation to identify the affected accounts.
2. Recompute the true totals from `app.journal_postings`.
3. Rewrite the projection's `debit_total_minor` and `credit_total_minor` from those totals and increment `version`.
4. Re-run reconciliation to confirm `PASS`.

The projection is the only repairable artefact; the ledger itself is never rewritten. Reconciliation reports drift but performs no automatic repair, so a mismatch is always surfaced to a human rather than silently corrected. An integration test deliberately corrupts a projection, asserts the `FAIL` result, restores it, and asserts the return to `PASS`.

## What reconciliation checks

| Code                               | Meaning                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------- |
| `UNBALANCED_JOURNAL`               | A journal's debits and credits differ, or it has fewer than two postings.  |
| `POSTING_CURRENCY_MISMATCH`        | A posting's currency differs from its journal or its ledger account.       |
| `NON_POSITIVE_POSTING_AMOUNT`      | A posting amount is zero or negative.                                      |
| `BALANCE_PROJECTION_DRIFT`         | A projection disagrees with the recomputed posting totals.                 |
| `MISSING_BALANCE_PROJECTION`       | A ledger account has no projection row.                                    |
| `CUSTOMER_ACCOUNT_LEDGER_MISMATCH` | A customer account lacks a liability ledger account in its currency.       |
| `DUPLICATE_DEFAULT_ACCOUNT`        | More than one default account exists for a customer, product and currency. |
| `NEGATIVE_CUSTOMER_BALANCE`        | A customer wallet balance is below zero.                                   |
| `MISSING_SYSTEM_ACCOUNT`           | The system chart of accounts is incomplete.                                |

Reconciliation is read-only apart from recording its own run, is protected by internal authentication, and reports only journal references, ledger account codes and masked account references — never a customer identifier.
