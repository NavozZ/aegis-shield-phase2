# Accounts and ledger demonstration

This guide shows how to provision a Tier-0 wallet and confirm that the double-entry ledger behind it is consistent.

> **Synthetic environment only.** Every account, customer and amount in this prototype is fake. Accounts hold no real money, and the account reference format is deliberately not a real bank account number. Never enter real customer data.

## Prerequisites

- Docker Desktop running (PostgreSQL and Redis)
- Node.js from `.nvmrc` and pnpm 11.8.0
- A local `.env` copied from `.env.example` with local-only secrets

A machine without Docker cannot run this demonstration. See [Running without Docker](#running-without-docker) below.

## 1. Start infrastructure and apply migrations

```powershell
pnpm install --frozen-lockfile
pnpm infra:validate
pnpm infra:up
pnpm infra:check
pnpm db:generate
pnpm db:deploy
```

`pnpm db:deploy` applies the Identity migrations and then the Ledger migrations, in that order. The Ledger migration also creates the two system accounts idempotently, with no opening balances.

## 2. Start the stack

```powershell
pnpm build
pnpm stack:start
```

The process manager starts Identity (4101), Ledger (4102), Gateway (4000) and Web (3000), waiting for each readiness endpoint before starting the next. Press `Ctrl+C` to stop everything cleanly; it leaves no process listening.

For a watch-mode developer loop use `pnpm dev` instead.

## 3. Create a Tier-0 account

1. Open <http://localhost:3000> and choose **Create secure access**.
2. Complete onboarding with a synthetic E.164 number such as `+12025550123`, the displayed local demonstration OTP, and a non-obvious six-digit PIN.
3. Continue to the secure workspace at `/app`.

The **Accounts and balances** panel shows **No account created yet**, a short explanation of the Tier-0 wallet, and a **Create Tier-0 account** button.

4. Select **Create Tier-0 account**.

Expected observations:

- A masked account reference in the form `AEGIS-****-****-XXXX`
- Account product **Tier-0 wallet**, status **Active**, currency **LKR**
- Current balance exactly **LKR 0.00**
- The create button is gone; the interface offers no second account

The account starts at zero. No opening journal entry is written and no funds are invented.

5. Reload the page. The account is still shown, rendered from server-side data.
6. Select the language selector and switch to සිංහල and then தமிழ். Every account label, button and notice is translated.

## 4. Confirm no duplicate account was created

The request carries an `Idempotency-Key`, and the Ledger enforces one default account per customer, product and currency. Repeating the request returns the original account rather than creating a second one.

```powershell
# From a browser devtools console on http://localhost:3000
await (await fetch('http://localhost:4000/api/v1/accounts', { credentials: 'include' })).json()
```

Expected: exactly one account in the list.

## 5. Confirm ownership isolation

Onboard a second synthetic customer in a private window, then request the first customer's account identifier from the second session:

```powershell
# Expect 404, not 403 — an account belonging to someone else is
# indistinguishable from one that does not exist.
await (await fetch('http://localhost:4000/api/v1/accounts/<other-account-id>', { credentials: 'include' })).status
```

## 6. Run reconciliation

```powershell
pnpm ledger:reconcile
```

Expected output is a `PASS` status with counts of the journals, postings, ledger accounts and customer accounts checked, and an empty issue list. The command exits non-zero on `FAIL`, so CI treats ledger drift as a build break.

Reconciliation reports journal references, ledger account codes and masked account references only. It never prints a customer identifier or a secret.

## 7. Clean shutdown

```powershell
# Ctrl+C in the stack window, then:
pnpm infra:down
```

Named volumes are preserved. Do not run `pnpm infra:reset` unless you intend to destroy local data.

## What is not available yet

- Transfers between customers and to external banks
- QR payments, USSD and agent cash
- Cards, loans, interest, fees and foreign exchange
- Transaction history
- SABCL, threat detection and disaster recovery

Only account creation and reads exist. There is no browser route that posts a journal entry; ledger movements are a trusted service-to-service operation.

## How CI validates the Ledger service

The `test` job in `.github/workflows/ci.yml` is the authoritative integration environment. It starts PostgreSQL and Redis, checks their health, generates both Prisma clients, applies the Identity and then Ledger migrations, and runs:

- Ledger unit tests
- Ledger integration tests, including database immutability, deferred balance validation, same-key concurrent idempotency and concurrent-debit overspend prevention
- Gateway unit tests and authentication end-to-end tests
- Gateway/Ledger accounts end-to-end tests
- Web unit tests
- The browser account journey and the accessibility checks
- `pnpm ledger:reconcile`

Infrastructure is always stopped afterwards.

## Running without Docker

<a id="running-without-docker"></a>

A machine that cannot run Docker can still do everything except the infrastructure-dependent steps:

```powershell
pnpm install --frozen-lockfile
pnpm db:validate:identity
pnpm db:validate:ledger
pnpm db:generate
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @aegis/contracts test
pnpm --filter @aegis/identity-service test
pnpm --filter @aegis/ledger-service test
pnpm --filter @aegis/api-gateway test
pnpm --filter @aegis/web test
pnpm build
```

Do not run `docker compose`, migration deployment, integration tests, service end-to-end tests or browser tests on such a machine, and never report those skipped checks as passed. Push the branch and let GitHub Actions perform the full validation, then run this demonstration later on a Docker-capable machine.
