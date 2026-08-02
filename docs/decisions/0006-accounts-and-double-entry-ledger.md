# ADR 0006: Accounts and double-entry ledger

- Status: Accepted
- Date: 2026-07-31
- Decision owners: AEGIS Shield Phase 2 team

## Context

The local data boundaries, the Identity service, and the authenticated browser experience are established. This decision introduces the first records that represent money: customer accounts and the balances behind them.

A banking ledger is the component where a silent defect is least acceptable and hardest to detect after the fact. It must survive concurrent requests, retried requests, partial failures and direct database access without ever producing a balance that the immutable record does not support.

## Decision

### Service ownership

Create `services/ledger` (`@aegis/ledger-service`) as an independent NestJS service on port 4102, owning the `aegis_ledger` database and `app` schema created by the local data infrastructure. It reads no other service's data store.

The Ledger performs no authentication. The API Gateway derives the customer identifier from a session validated by the Identity service and passes it internally. Authentication logic is not duplicated into the Ledger, and a customer identifier supplied by a browser is never trusted.

### Customer account model

One default Tier-0 wallet per `(customerId, productType, currency)`, enforced by a unique constraint. Default currency `LKR`. Each customer account is backed by exactly one ledger account.

Accounts carry a synthetic `AEGIS-XXXX-XXXX-XXXX` public reference. Only a masked form (`AEGIS-****-****-XXXX`) is exposed outside the service. The format is deliberately not a real bank account number and carries no routing meaning. Internal ledger account identifiers are never exposed to a browser.

### Liability treatment of customer funds

Customer wallets are `LIABILITY` accounts: customer money is an obligation of the platform, not a platform asset. A CREDIT increases the customer's visible balance, a DEBIT decreases it. Balance is derived per account class rather than stored as a signed number:

- `ASSET`, `EXPENSE`: `debitTotal - creditTotal`
- `LIABILITY`, `EQUITY`, `REVENUE`: `creditTotal - debitTotal`

### Integer minor units

All money is an integer count of minor units: `BigInt` in the service, `BIGINT` in PostgreSQL, and a decimal **string** in every contract and JSON payload. JavaScript numbers and floating-point column types are never used for money, because balances can exceed `Number.MAX_SAFE_INTEGER` and binary floating point cannot represent decimal currency exactly.

### Immutable journals

Journal entries and postings are append-only. Posting amounts are always strictly positive and the direction column carries the sign, so a stored negative amount can never silently invert a balance. Corrections will be made by posting a reversing entry, never by editing history.

### Balance projection

A `BalanceProjection` row per ledger account holds debit and credit totals plus a version, updated inside the same transaction as the postings that changed it. The projection is an optimisation only: the authoritative balance is always recomputable from the immutable postings, and reconciliation compares the two.

### Database-level constraints

Correctness is enforced by PostgreSQL, not only by TypeScript:

- `CHECK` constraints for positive posting amounts, currency format, reference format, sequence range, non-negative projection totals, and account class matching its normal balance.
- Unique constraints on journal reference, account code, system account type, `(customerId, productType, currency)`, `(journalEntryId, sequence)` and `(scope, keyHash)`.
- `BEFORE UPDATE OR DELETE` triggers that reject every mutation of a posted journal entry or posting.
- Deferred `CONSTRAINT TRIGGER`s that re-check, at COMMIT, that each journal balances, holds at least two postings, uses one currency, and posts only to accounts in that currency.
- An `AFTER INSERT` trigger that creates a balance projection with every ledger account, so an account with postings can never lack one.

The application validates the same rules first, to return a useful error before opening a transaction. The database check is the authoritative backstop.

### Idempotency

Every state-changing operation requires an `Idempotency-Key`, distinct from the correlation ID. The service stores a hash of the key and a hash of the canonical request payload. The reservation row is written inside the same transaction as the work, so a concurrent duplicate blocks on the unique index rather than executing twice; the loser replays the stored response. A key reused with a different payload is a `409 IDEMPOTENCY_CONFLICT`. Raw keys are never persisted or logged.

### Concurrency control

Journal posting locks every affected ledger account and balance projection with `SELECT ... FOR UPDATE` ordered by account identifier. One deterministic order across all callers avoids deadlock, and the row locks make the insufficient-funds check atomic. Account provisioning takes a `pg_advisory_xact_lock` keyed on customer, product and currency so a read-then-create cannot race. No in-memory mutex is used as primary protection, because it would not hold across processes.

### Reconciliation

A read-only reconciliation pass recomputes every invariant from the immutable postings and records a `PASS`/`FAIL` run with bounded issue detail. It reports journal references, ledger account codes and masked account references — never customer identifiers.

## Consequences

- Customer accounts open at exactly zero. No opening journal entry is written and no funds are invented.
- Balances remain exact at any magnitude, at the cost of every consumer handling strings rather than numbers.
- History cannot be edited or deleted, including by a future migration or an operator with database access. Corrections require reversing entries.
- A rejected posting leaves no partial journal: the transaction is atomic and the deferred triggers refuse to let an unbalanced entry commit.
- Concurrent debits cannot overdraw a wallet; the loser receives `INSUFFICIENT_FUNDS` rather than a corrupted balance.
- Deterministic lock ordering serialises journals that share an account, which bounds throughput on hot accounts. Acceptable at prototype scale and revisited if it becomes a constraint.
- The Gateway gained a second internal dependency, so its readiness now reports Identity and Ledger.

## Residual risks

- Idempotency records are retained for 24 hours with an `expiresAt` column but no scheduled purge yet; the table grows until a later milestone adds one.
- Reconciliation runs on demand rather than on a schedule, and repairs nothing automatically. A projection mismatch is reported, not corrected.
- Only `ACTIVE` accounts are implemented. `FROZEN` and `CLOSED` exist in the model with no transitions, so no status-based posting restriction is exercised yet.
- The service trusts the Gateway's internal token completely. Workload identity and mTLS remain deferred.
- Multi-currency accounts are modelled but untested beyond `LKR`; no foreign exchange exists.
- The append-only triggers can be dropped by a superuser migration. Protecting migrations themselves is out of scope for this prototype.
