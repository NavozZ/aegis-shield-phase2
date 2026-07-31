# Ledger service

`@aegis/ledger-service` owns customer accounts and the AEGIS double-entry ledger. It is an internal NestJS service; browsers call the API Gateway, never this service directly.

It performs no authentication of its own. The customer identifier always arrives from the API Gateway, which derives it from a validated session issued by the Identity service.

## Runtime boundaries

- Loopback development address: `http://127.0.0.1:4102`
- PostgreSQL ownership: the `aegis_ledger` database and `app` schema
- Browser CORS: disabled
- Internal calls: every non-public route requires `x-aegis-internal-token`

The service owns customer account records, the chart of ledger accounts, immutable journal entries and postings, balance projections, idempotency records and reconciliation runs. It reads no other service's database.

## Money handling

Every monetary amount is an integer count of **minor units** held as a `BigInt` in the service and a `BIGINT` column in PostgreSQL. Amounts cross service and browser boundaries as decimal strings:

```json
{ "currency": "LKR", "minorUnits": "0" }
```

A JavaScript `number` is never used for money anywhere in the path, because a balance can exceed `Number.MAX_SAFE_INTEGER`. Floating-point column types are not used.

## Accounting model

Customer wallets are **LIABILITY** accounts: customer funds are money the platform owes the customer.

| Account class              | Normal balance | Balance formula            |
| -------------------------- | -------------- | -------------------------- |
| ASSET, EXPENSE             | DEBIT          | `debitTotal - creditTotal` |
| LIABILITY, EQUITY, REVENUE | CREDIT         | `creditTotal - debitTotal` |

So for a customer wallet a **CREDIT increases** the visible balance and a **DEBIT decreases** it.

Every posted journal must satisfy `sum(DEBIT) = sum(CREDIT)`, carry at least two postings, use one currency, and reference only accounts in that currency. Posting amounts are always strictly positive; the direction carries the sign.

## System accounts

Created idempotently by the initial migration with no opening balances and no journal entries:

| System account type                | Code                             | Class     | Normal balance | Purpose                                                            |
| ---------------------------------- | -------------------------------- | --------- | -------------- | ------------------------------------------------------------------ |
| `PLATFORM_SETTLEMENT_ASSET`        | `SYS-PLATFORM-SETTLEMENT-LKR`    | ASSET     | DEBIT          | Counterparty for funds entering or leaving the prototype platform. |
| `CUSTOMER_FUNDS_LIABILITY_CONTROL` | `SYS-CUSTOMER-FUNDS-CONTROL-LKR` | LIABILITY | CREDIT         | Control account for aggregate customer obligations.                |

Both permit a negative balance because they represent platform positions rather than customer funds. Customer wallets never do.

## Configuration

Copy the root `.env.example` to the ignored `.env` and configure:

- `LEDGER_HOST`, `LEDGER_SERVICE_PORT`, and `LEDGER_SERVICE_URL`
- `LEDGER_DATABASE_URL` with `?schema=app`
- `LEDGER_INTERNAL_TOKEN`
- `LEDGER_DEFAULT_CURRENCY` (`LKR`)
- `LEDGER_IDEMPOTENCY_RETENTION_HOURS` and `LEDGER_MAX_POSTING_RETRIES`

Production startup rejects known local placeholders. Never print these values, expose them to a browser, prefix them with `NEXT_PUBLIC_`, or commit `.env`.

## Database lifecycle

Run from the repository root:

```powershell
pnpm db:validate:ledger
pnpm db:generate:ledger
pnpm db:migrate:ledger
pnpm db:deploy:ledger
```

Use `db:migrate:ledger` only while deliberately developing a migration. Normal startup does not change the database.

## Endpoints

Health:

- `GET /health` and `GET /health/live` check the process and are public.
- `GET /health/ready` checks PostgreSQL and requires the internal token.

Internal accounts:

- `POST /internal/customer-accounts/default`
- `GET /internal/customers/:customerId/accounts`
- `GET /internal/customer-accounts/:accountId`
- `GET /internal/customer-accounts/:accountId/balance`

The two account-scoped reads require an `x-aegis-customer-id` header. Ownership is part of the query, so an account belonging to another customer is indistinguishable from one that does not exist.

Internal ledger and reconciliation:

- `POST /internal/journal-entries`
- `POST /internal/reconciliation`
- `GET /internal/reconciliation/latest`

`POST /internal/journal-entries` exists for tests and future trusted services. The API Gateway deliberately exposes no browser route that reaches it.

## Idempotency

Every state-changing operation requires an `Idempotency-Key`. The service stores a SHA-256 hash of the key and a SHA-256 hash of the canonical request payload — never the raw key, and never the raw payload.

- Same key, same payload → the original stored response is replayed.
- Same key, different payload → `IDEMPOTENCY_CONFLICT` (409).
- A concurrent duplicate blocks on the unique index rather than executing twice.

Retention is `LEDGER_IDEMPOTENCY_RETENTION_HOURS` (24 hours by default); records carry `expiresAt` and a scheduled purge is deferred to a later milestone. Logs contain only a truncated non-reversible fingerprint of a key.

## Concurrency

Journal posting locks every affected ledger account and its balance projection with `SELECT ... FOR UPDATE`, ordered by account identifier. A single deterministic order across all callers prevents deadlock, and the row locks make the insufficient-funds check atomic: two concurrent debits cannot spend the same balance. Account provisioning additionally takes a `pg_advisory_xact_lock` keyed on customer, product and currency. No in-memory mutex is used.

## Testing

Unit tests require no infrastructure:

```powershell
pnpm ledger:test
```

Integration, end-to-end and reconciliation runs require PostgreSQL and therefore run in GitHub Actions or on a Docker-capable machine:

```powershell
pnpm ledger:test:integration
pnpm ledger:test:e2e
pnpm ledger:reconcile
```

Integration tests use synthetic random customer identifiers. Posted journals and postings are append-only and are never deleted; scoped cleanup removes only accounts that received no postings, and only under `NODE_ENV=test`.

## Prototype limitations

There are no transfers, external payments, QR, USSD, agent cash, cards, loans, interest, fees or foreign exchange. Only `ACTIVE` account creation and reads are implemented; `FROZEN` and `CLOSED` exist in the model but have no transitions yet. Transaction history arrives in Prompt 06. Accounts are synthetic, start at zero and hold no real money.
