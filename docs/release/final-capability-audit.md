# Final capability audit

This is the closing inventory of AEGIS Shield Phase 2. For every capability the
platform claims, it names the code that implements it, the tests that hold it to
account, the continuous-integration step that runs those tests, the document that
explains the design, the command a reviewer can type, and an honest status.

The audit exists because a feature list is cheap. Anyone can write "encrypted
backups" on a slide. What is expensive, and what a judge should actually weigh,
is whether the claim survives contact with a file path, a test name and a CI step
name. Every cell below was read out of this repository. Where an artefact does
not exist, the cell says `none` rather than inventing one, and the
[recorded gaps](#recorded-gaps) section collects those in one place so nothing is
buried.

---

## How to read this document

Each capability is recorded as a small two-column table covering the same
aspects. Long evidence lists are split across several rows rather than crammed
into one cell, so the raw markdown stays readable in a diff.

| Aspect                 | Meaning                                                                      |
| ---------------------- | ---------------------------------------------------------------------------- |
| Implementation         | The source file or files that actually do the work.                          |
| Unit test              | A test that runs with no database, no Redis and no network.                  |
| Integration / e2e test | A test that needs real PostgreSQL, real Redis or real service processes.     |
| Browser test           | A Playwright test driving real Chromium against the running stack.           |
| CI step                | The verbatim `name:` of the step in `.github/workflows/ci.yml` that runs it. |
| Documentation          | The design, threat-model or runbook document a reviewer should read.         |
| Command                | The `package.json` script a reviewer can run.                                |
| Status                 | What has been proven, and where.                                             |

### Status labels

Only these labels are used, and they mean exactly what they say.

| Label                                  | Meaning                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------- |
| `PASS LOCALLY`                         | Ran on the development VM and passed. Needs no Docker.                  |
| `PASS IN CI`                           | Ran in GitHub Actions against real PostgreSQL 17 and Redis, and passed. |
| `NOT RUN LOCALLY — Docker unavailable` | Cannot run on the development VM; the authoritative result is from CI.  |
| `FAIL`                                 | Ran and did not pass.                                                   |
| `BLOCKED`                              | Could not run for a reason other than the absent Docker engine.         |

### Where the authority sits

The development VM has no working Docker engine. `docker version` reports the
client, and the server returns `request returned 500 Internal Server Error for
API route and version
http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.55/version`.

That has one consequence, and it is stated plainly rather than worked around:
**anything needing PostgreSQL, Redis or a running service is authoritative in
GitHub Actions, not on the owner's machine.** No clean-room claim is made for
this machine. The Docker-independent surface — `pnpm format:check`, `pnpm lint`,
`pnpm typecheck`, `pnpm build`, unit tests, tooling tests, contract tests and web
component tests — ran locally. Everything else is `PASS IN CI`.

CI is exactly four jobs: `lint`, `typecheck`, `test` and `build`. The `test` job
starts real PostgreSQL 17 and Redis in Docker, applies all five committed
migration sets, then runs the units, the integration suites, the
service-to-service end-to-end suites, the Playwright functional and accessibility
runs, evidence capture, backup, negative backup, isolated restore, the
disaster-recovery drill, the four reconciliations, and a cleanup step that
asserts no plaintext dump survived. CI never uploads dumps, decrypted files,
`.env`, tokens or keys.

---

## Summary

| #   | Capability                  | Area               | Primary command                                   | Development VM                         | GitHub Actions |
| --- | --------------------------- | ------------------ | ------------------------------------------------- | -------------------------------------- | -------------- |
| 1   | Authentication              | Identity           | `pnpm auth:test`                                  | `PASS LOCALLY`                         | `PASS IN CI`   |
| 2   | Passkeys                    | Identity           | `pnpm auth:test`                                  | `PASS LOCALLY`                         | `PASS IN CI`   |
| 3   | Accounts                    | Money              | `pnpm ledger:test`                                | `PASS LOCALLY`                         | `PASS IN CI`   |
| 4   | Transaction history         | Money              | `pnpm web:test:transactions`                      | `PASS LOCALLY`                         | `PASS IN CI`   |
| 5   | Transfers                   | Money              | `pnpm payments:test`                              | `PASS LOCALLY`                         | `PASS IN CI`   |
| 6   | QR Pay                      | Inclusive channels | `pnpm channels:test:qr`                           | `PASS LOCALLY`                         | `PASS IN CI`   |
| 7   | USSD                        | Inclusive channels | `pnpm channels:test:ussd`                         | `PASS LOCALLY`                         | `PASS IN CI`   |
| 8   | Agent Cash                  | Inclusive channels | `pnpm channels:test:agent`                        | `PASS LOCALLY`                         | `PASS IN CI`   |
| 9   | SABCL/1                     | Metadata           | `pnpm sabcl:test`                                 | `PASS LOCALLY`                         | `PASS IN CI`   |
| 10  | Risk                        | Threat detection   | `pnpm risk:test`                                  | `PASS LOCALLY`                         | `PASS IN CI`   |
| 11  | Security-operator console   | Threat detection   | `pnpm web:test:e2e`                               | `NOT RUN LOCALLY — Docker unavailable` | `PASS IN CI`   |
| 12  | Encrypted backup            | Resilience         | `pnpm dr:backup`                                  | `PASS LOCALLY`                         | `PASS IN CI`   |
| 13  | Restore verification        | Resilience         | `pnpm dr:restore:verify -- --set <backup-set-id>` | `PASS LOCALLY`                         | `PASS IN CI`   |
| 14  | Disaster-recovery drill     | Resilience         | `pnpm dr:drill`                                   | `PASS LOCALLY`                         | `PASS IN CI`   |
| 15  | Recovery operations console | Resilience         | `pnpm web:test`                                   | `PASS LOCALLY`                         | `PASS IN CI`   |
| 16  | Reconciliation              | Assurance          | `pnpm reconcile:all`                              | `PASS LOCALLY`                         | `PASS IN CI`   |
| 17  | Accessibility               | Assurance          | `pnpm web:test:a11y`                              | `PASS LOCALLY`                         | `PASS IN CI`   |

A `PASS LOCALLY` in the development-VM column refers to that capability's unit,
contract, tooling and component tests only. Every integration, end-to-end and
browser test is `NOT RUN LOCALLY — Docker unavailable`, and each table below says
so explicitly rather than letting the summary imply more than was proven.

---

## 1–2. Identity and access

Authentication is the first trust boundary, so it deliberately carries the most
redundant evidence: unit tests over each primitive, a real service-boundary
end-to-end suite through the Gateway, and a Chromium journey that completes
onboarding, restores a session, logs out and confirms a protected route
redirects. Sessions are opaque values in Redis rather than self-describing
tokens, so revocation is immediate and a stolen value proves nothing about the
customer. The session cookie is `HttpOnly`; the double-submit CSRF value is
deliberately readable, because the browser has to be able to echo it back.

Passkeys are audited separately because they have a distinct failure surface —
challenge replay and authenticator counter regression — and because their browser
evidence differs in kind: a Chromium virtual authenticator performing a real
WebAuthn ceremony, not a mock.

### 1. Authentication

| Aspect                   | Artefact                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Implementation (service) | `services/identity/src/auth/` — `onboarding/`, `otp/`, `pin/`, `sessions/`, `fallback/`, `events/`                               |
| Implementation (edge)    | `apps/api-gateway/src/auth/{auth.controller.ts,cookies.ts,identity.client.ts}`, `common/http/csrf.ts`                            |
| Implementation (web)     | `apps/web/src/components/auth/{onboarding-flow.tsx,sign-in-flow.tsx}`, `src/lib/api/csrf.ts`                                     |
| Unit test (service)      | `otp.service.spec.ts`, `pin.service.spec.ts`, `session.service.spec.ts`, `auth-event.service.spec.ts`                            |
| Unit test (edge)         | `cookies.spec.ts`, `auth-rate-limit.middleware.spec.ts`, `rate-limit-buckets.spec.ts`                                            |
| Unit test (contract/web) | `packages/contracts/src/auth/v1.test.ts`, `auth-client.test.ts`, `server-session.test.ts`                                        |
| Integration / e2e test   | `apps/api-gateway/test/auth.e2e-spec.ts`, `services/identity/test/app.e2e-spec.ts`                                               |
| Browser test             | `apps/web/e2e/authentication.spec.ts` — four `@functional` journeys                                                              |
| CI step                  | `Test Identity service`; `Test API Gateway`; `Test authentication end to end`                                                    |
| Documentation            | [threat model](../security/authentication-threat-model.md), [ADR 0004](../decisions/0004-identity-and-session-authentication.md) |
| Documentation (UX)       | [ADR 0005](../decisions/0005-authentication-user-experience.md), [demo](../demo/authentication-demo.md)                          |
| Command                  | `pnpm auth:test`, then `pnpm auth:test:e2e`                                                                                      |
| Status — development VM  | `PASS LOCALLY` (units, contracts, components); the rest `NOT RUN LOCALLY — Docker unavailable`                                   |
| Status — GitHub Actions  | `PASS IN CI`                                                                                                                     |

The end-to-end case is named
`completes onboarding, cookie session, logout, and PIN plus OTP fallback`. The
Identity boundary suite asserts that liveness stays public while readiness
requires the service token, and that readiness reports real PostgreSQL and Redis
state without leaking a secret. `otp.service.spec.ts` asserts the service
`stores only a keyed OTP digest with TTL`, and that it
`never exposes a demo OTP when the provider disables it`.

### 2. Passkeys

| Aspect                  | Artefact                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Implementation          | `services/identity/src/auth/passkeys/{passkey.service.ts,webauthn.adapter.ts}`                                                   |
| Implementation (web)    | `apps/web/src/lib/auth/passkeys.ts`, `apps/web/src/components/auth/passkey-enrollment.tsx`                                       |
| Unit test               | `services/identity/src/auth/passkeys/passkey.service.spec.ts` — five cases                                                       |
| Integration / e2e test  | `apps/api-gateway/test/auth.e2e-spec.ts` (enrollment token across the Gateway session boundary)                                  |
| Browser test            | `apps/web/e2e/authentication.spec.ts` — `registers and authenticates a real virtual passkey ceremony`                            |
| CI step                 | `Test Identity service`; `Install Playwright Chromium`                                                                           |
| Documentation           | [threat model](../security/authentication-threat-model.md), [ADR 0004](../decisions/0004-identity-and-session-authentication.md) |
| Command                 | `pnpm auth:test`, then `pnpm web:test:e2e`                                                                                       |
| Status — development VM | `PASS LOCALLY` (units); the browser ceremony `NOT RUN LOCALLY — Docker unavailable`                                              |
| Status — GitHub Actions | `PASS IN CI`                                                                                                                     |

The five unit cases are challenge storage with TTLs, single-use registration
challenges that reject replay, rejection of a revoked credential while consuming
the authentication challenge, counter-boundary update on success, and
`rejects an unexpected authenticator counter regression` — the case that catches
a cloned authenticator.

---

## 3–5. Accounts, history and money movement

The Ledger is the only balance authority in the platform. Payments orchestrates a
transfer, Identity authorizes it and Risk can veto it, but none of them may
compute a balance — that separation is what makes the double-entry model worth
having. Money is integer minor units end to end: `BIGINT` in PostgreSQL, `BigInt`
in the services, decimal strings on the wire. One unit case exists purely to
assert the service
`never converts transfer money through Number, parseInt or parseFloat`.

The integrity claims are enforced twice: once in the service, once by deferred
constraint triggers in the database.
`services/ledger/test/ledger.integration-spec.ts` proves the second layer by
issuing raw SQL that bypasses the service entirely and asserting the transaction
still fails `at COMMIT`.

### 3. Accounts and the double-entry ledger

| Aspect                   | Artefact                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Implementation           | `services/ledger/src/accounts/`, `src/ledger/journal.service.ts`, `src/money/money.ts`                                             |
| Implementation (support) | `services/ledger/src/idempotency/idempotency.service.ts`, `services/ledger/prisma/migrations/`                                     |
| Implementation (edge)    | `apps/api-gateway/src/accounts/`, `apps/web/src/components/accounts/account-panel.tsx`                                             |
| Unit test (service)      | `account.spec.ts`, `account-reference.spec.ts`, `journal.spec.ts`, `money.spec.ts`, `idempotency.spec.ts`                          |
| Unit test (edge)         | `accounts.controller.spec.ts`, `ledger.client.spec.ts`, `packages/contracts/src/accounts/v1.test.ts`                               |
| Integration / e2e test   | `services/ledger/test/ledger.integration-spec.ts`; `apps/api-gateway/test/accounts.e2e-spec.ts`                                    |
| Browser test             | `apps/web/e2e/accounts.spec.ts` — `@functional Tier-0 account provisioning browser journey`                                        |
| CI step                  | `Test Ledger transfer units including transaction history`                                                                         |
| CI step (integration)    | `Test Ledger PostgreSQL transfer integration and concurrency`                                                                      |
| CI step (end to end)     | `Test authenticated account and transaction routes end to end`                                                                     |
| Documentation            | [ledger integrity model](../security/ledger-integrity-model.md), [ADR 0006](../decisions/0006-accounts-and-double-entry-ledger.md) |
| Documentation (demo)     | [accounts and ledger demonstration](../demo/accounts-ledger-demo.md)                                                               |
| Command                  | `pnpm ledger:test`, then `pnpm ledger:test:integration` and `pnpm ledger:test:e2e`                                                 |
| Status — development VM  | `PASS LOCALLY` (units, contracts, components); the rest `NOT RUN LOCALLY — Docker unavailable`                                     |
| Status — GitHub Actions  | `PASS IN CI`                                                                                                                       |

The integration suite is where the concurrency claims are settled:
`creates exactly one account under concurrent identical requests`,
`prevents concurrent debits from overspending the balance`, and a database-level
block that rejects an unbalanced journal `at COMMIT even from raw SQL`, rejects a
journal with a single posting, and `refuses to update a posted journal entry`.

### 4. Transaction history

| Aspect                  | Artefact                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Implementation          | `services/ledger/src/transactions/{transaction.service.ts,transaction.controller.ts}`                              |
| Implementation (web)    | `apps/web/src/components/accounts/{transaction-history.tsx,recent-activity.tsx,print-record-button.tsx}`           |
| Implementation (pages)  | `apps/web/src/app/app/accounts/[accountId]/page.tsx` and `.../transactions/[transactionId]/page.tsx`               |
| Unit test (service)     | `services/ledger/src/transactions/transaction.service.spec.ts` — eleven cases                                      |
| Unit test (web)         | `transaction-history.test.tsx`, `recent-activity.test.tsx`, `print-record-button.test.tsx`, `print-layout.test.ts` |
| Integration / e2e test  | `ledger.integration-spec.ts` `customer transaction history` block; `apps/api-gateway/test/accounts.e2e-spec.ts`    |
| Browser test            | `apps/web/e2e/accounts.spec.ts` — 22 postings, direction filter, `Load more`, printable record                     |
| CI step                 | `Test Ledger transfer units including transaction history`                                                         |
| CI step (web)           | `Test web transfer components including polling and idempotency`                                                   |
| Documentation           | [transaction-history privacy boundary](../security/transaction-history-privacy.md)                                 |
| Documentation (design)  | [ADR 0007](../decisions/0007-customer-transaction-history.md), [demo](../demo/dashboard-transactions-demo.md)      |
| Command                 | `pnpm web:test:transactions`, then `pnpm transactions:test:integration` and `pnpm transactions:test:e2e`           |
| Status — development VM | `PASS LOCALLY` (units, components); the rest `NOT RUN LOCALLY — Docker unavailable`                                |
| Status — GitHub Actions | `PASS IN CI`                                                                                                       |

Cursors are versioned and opaque, and both suites check that one cannot be
carried across a change of filter:
`paginates without duplicates or skipped postings`,
`rejects malformed and filter-mismatched cursors`, and
`enforces account and transaction ownership with the same 404` — the same status
for "does not exist" and "not yours", so the response cannot be used as an
existence oracle. The browser journey additionally asserts the page never renders
`ledgerAccountId`, `customerId`, `createdBy`, `correlationId` or `metadata`.

### 5. Secure customer transfers

| Aspect                    | Artefact                                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation            | `services/payments/src/transfers/{transfers.service.ts,ledger.client.ts,risk.client.ts}`                                                |
| Implementation (ledger)   | `services/ledger/src/transfers/customer-transfer.service.ts`                                                                            |
| Implementation (step-up)  | `services/identity/src/auth/step-up/transfer-step-up.service.ts`                                                                        |
| Implementation (edge)     | `apps/api-gateway/src/transfers/`, `apps/web/src/components/transfers/`                                                                 |
| Implementation (recovery) | `services/payments/scripts/recover.mjs`                                                                                                 |
| Unit test (service)       | `transfers.service.spec.ts` (18 cases), `customer-transfer.service.spec.ts`, `risk.client.spec.ts`                                      |
| Unit test (step-up)       | `services/identity/src/auth/step-up/transfer-step-up.service.spec.ts` (4 cases)                                                         |
| Unit test (edge)          | `transfers.controller.spec.ts` (12 cases), `payments.client.spec.ts`, `payments/v1.test.ts`                                             |
| Unit test (web)           | `transfer-form.test.tsx`, `transfer-list.test.tsx`, `transfer-record.test.tsx`, `storage-privacy.test.ts`                               |
| Integration test          | `services/payments/test/payments.integration-spec.ts`; `ledger.integration-spec.ts` transfers                                           |
| End-to-end test           | `apps/api-gateway/test/transfers.e2e-spec.ts`                                                                                           |
| Browser test              | `apps/web/e2e/transfers.spec.ts` — `@functional real two-customer transfer browser journey`                                             |
| CI step                   | `Test Payments units`; `Test Identity transfer step-up`                                                                                 |
| CI step (integration)     | `Test Payments PostgreSQL transfer processing`                                                                                          |
| CI step (end to end)      | `Test real Gateway Identity Payments Ledger transfers end to end`                                                                       |
| Documentation             | [fund transfer model](../security/fund-transfer-model.md), [threat model](../security/transfer-threat-model.md)                         |
| Documentation (ops)       | [idempotency and recovery](../security/payment-idempotency-and-recovery.md), [ADR 0008](../decisions/0008-secure-customer-transfers.md) |
| Documentation (demo)      | [customer transfer demonstration](../demo/customer-transfer-demo.md)                                                                    |
| Command                   | `pnpm payments:test`, then `pnpm payments:test:integration` and `pnpm payments:test:e2e`                                                |
| Status — development VM   | `PASS LOCALLY` (units, contracts, components); the rest `NOT RUN LOCALLY — Docker unavailable`                                          |
| Status — GitHub Actions   | `PASS IN CI`                                                                                                                            |

An intent is short-lived and single-use: the service
`creates a one-time intent and stores only its SHA-256 token hash`, so the
database never holds a value that could authorize a transfer. Bounded recovery is
tested rather than asserted —
`claims stale rows with SKIP LOCKED and completes recovery` and
`moves a stale row to REQUIRES_REVIEW at the attempt limit` — and the integration
suite proves the same behaviour under real concurrency with
`serializes concurrent duplicate confirmation into one Transfer` and
`enforces the daily limit under concurrent reservations`. The end-to-end case is
`executes, replays, recovers and privately exposes a real transfer`. The browser
journey deliberately fails a PIN first, then replays the confirmation with the
same idempotency key from inside the page.

---

## 6–8. Inclusive channels

These channels exist because a banking prototype that only works on a recent
smartphone with a data plan is not an inclusive one. All three share the Payments
service, the Ledger as balance authority and the same integer money discipline;
they differ in how an instruction reaches the platform, and therefore in how it
can be forged.

All three run as unit suites with mocked Prisma, Redis and Ledger clients, so
they need no Docker. Their configuration is treated as part of the security
surface: `services/payments/src/common/config/payments.config.spec.ts` asserts
that Payments **refuses to start without a QR signing key rather than inventing
one** — a fabricated default would make every QR code forgeable — and that
shipped placeholder secrets are rejected when `NODE_ENV` is production.

The channel routes are loopback-bound internal paths behind `InternalTokenGuard`,
registered as an `APP_GUARD` in `services/payments/src/app.module.ts`. A browser
reaches them only through `apps/api-gateway/src/channels/channels.controller.ts`,
which requires a session and a CSRF token.

### 6. QR Pay

| Aspect                  | Artefact                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| Implementation          | `services/payments/src/qr/{qr.service.ts,qr-crypto.ts,qr.controller.ts}`                       |
| Implementation (web)    | `apps/web/src/app/app/channels/qr/page.tsx`, contract `packages/contracts/src/channels/v1.ts`  |
| Unit test               | `services/payments/src/qr/qr.service.spec.ts` — six cases                                      |
| Unit test (config)      | `services/payments/src/common/config/payments.config.spec.ts` — signing key and TTL validation |
| Integration / e2e test  | `none` dedicated; the journal types it posts are covered by the Ledger posting suites          |
| Browser test            | `none` functional; `apps/web/e2e/evidence.spec.ts` renders and scans `/channels/qr`            |
| CI step                 | `Test QR signing, tampering, expiry and replay`                                                |
| CI step (config)        | `Test Payments application startup and channel configuration`                                  |
| Documentation           | [inclusive channels threat model](../security/inclusive-channels-threat-model.md)              |
| Documentation (demo)    | [demonstration plan](../demo/README.md)                                                        |
| Command                 | `pnpm channels:test:qr`, or `pnpm channels:test` for all three                                 |
| Status — development VM | `PASS LOCALLY`                                                                                 |
| Status — GitHub Actions | `PASS IN CI`                                                                                   |

The six unit cases are dynamic issue, `ACCOUNT_NOT_FOUND` when the Ledger cannot
resolve the account, successful preview, `rejects self-transfer`,
`rejects expired QR payload` and `rejects tampered signature`.

### 7. USSD

| Aspect                  | Artefact                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------- |
| Implementation          | `services/payments/src/ussd/{ussd.service.ts,ussd.controller.ts}`                       |
| Implementation (web)    | `apps/web/src/app/app/channels/ussd/page.tsx`                                           |
| Unit test               | `services/payments/src/ussd/ussd.service.spec.ts` — `should handle USSD flow correctly` |
| Unit test (wiring)      | `services/payments/src/app.module.spec.ts` — the channel receives a real `LedgerClient` |
| Integration / e2e test  | `none` dedicated                                                                        |
| Browser test            | `none` functional; `apps/web/e2e/evidence.spec.ts` renders and scans `/channels/ussd`   |
| CI step                 | `Test USSD session state, expiry and webhook security`                                  |
| CI step (config)        | `Test Payments application startup and channel configuration`                           |
| Documentation           | [inclusive channels threat model](../security/inclusive-channels-threat-model.md)       |
| Documentation (demo)    | [demonstration plan](../demo/README.md)                                                 |
| Command                 | `pnpm channels:test:ussd`                                                               |
| Status — development VM | `PASS LOCALLY`                                                                          |
| Status — GitHub Actions | `PASS IN CI`                                                                            |

The unit case walks the whole bounded menu — `*123#`, send money, recipient,
amount, confirmation, PIN — and asserts a real Ledger transfer was issued at the
end rather than only that the last screen said so. Session state lives in Redis
under a five-minute TTL written at
`services/payments/src/ussd/ussd.service.ts:164`, so an abandoned menu expires
instead of lingering. The webhook is authenticated by the service-wide
`InternalTokenGuard`. See the [recorded gaps](#recorded-gaps) for what the unit
suite does not itself assert.

### 8. Agent Cash

| Aspect                  | Artefact                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| Implementation          | `services/payments/src/agent/{agent.service.ts,agent.controller.ts}`                           |
| Implementation (limits) | Per-transaction limit at `agent.service.ts:49`, daily velocity at `:91`, key hashing at `:165` |
| Implementation (schema) | `services/payments/prisma/migrations/20260801150000_p08_qr_agent_models/`                      |
| Implementation (web)    | `apps/web/src/app/app/channels/agent/page.tsx`                                                 |
| Unit test               | `services/payments/src/agent/agent.service.spec.ts` — three cases                              |
| Integration / e2e test  | `none` dedicated; settlement journal types are covered by the Ledger posting suites            |
| Browser test            | `none` functional; `apps/web/e2e/evidence.spec.ts` renders and scans `/channels/agent`         |
| CI step                 | `Test agent cash authorization, limits and idempotency`                                        |
| CI step (config)        | `Test Payments application startup and channel configuration`                                  |
| Documentation           | [inclusive channels threat model](../security/inclusive-channels-threat-model.md)              |
| Documentation (demo)    | [demonstration plan](../demo/README.md)                                                        |
| Command                 | `pnpm channels:test:agent`                                                                     |
| Status — development VM | `PASS LOCALLY`                                                                                 |
| Status — GitHub Actions | `PASS IN CI`                                                                                   |

The three unit cases are successful cash-in preview, rejection when the customer
account cannot be resolved, and `confirms and settles a cash-in operation`.

---

## 9. SABCL/1 — metadata protection

SABCL is the genuinely unusual part of this platform, so it carries the heaviest
evidence. The claim is not "we use TLS". The claim is that an independent router
on port 4103 forwards a service call to the correct destination while holding no
key that opens the payload, and while learning nothing from the outside of the
envelope that would be worth selling.

That claim is only worth making if it is tested adversarially.
`packages/sabcl/src/protocol/leakage.test.ts` seeds sensitive values into a
payload, seals it, and then asserts across eight cases that the outer envelope
contains none of them, that it carries only the documented fields, that
`no outer field contains an endpoint path or business operation name`, that
`the opaque outer fields stay opaque across many sealings`, and that
`the route token is not reversible to the capability it selects`. The strict-mode
journey in `services/sabcl-router/test/strict-mode.integration-spec.ts` then runs
a real encrypted account retrieval over real sockets and asserts the router
process never sees the payload, that a replay is refused across the whole path,
that it `refuses a tampered envelope at the recipient, not at the router`, and
that an unreachable router
`fails safely when the router is unreachable, with no plaintext fallback`.

`SABCL_MODE` ships as `off`, and the router process starts only when it is not
`off`. That is deliberate: the demonstration stack must be runnable without key
material, and a strict load with no keyring should fail loudly rather than
degrade silently. Strict mode is proven instead by the suites that build their
own keyring from deterministic fixtures, which is why the CI `test` job does not
set `SABCL_MODE` job-wide — the reasoning is recorded in a comment block in
`.github/workflows/ci.yml`.

| Aspect                    | Artefact                                                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation (crypto)   | `packages/sabcl/src/crypto/{primitives.ts,keyring.ts}` — X25519, HKDF, AES-256-GCM, Ed25519                                                                           |
| Implementation (protocol) | `packages/sabcl/src/protocol/{seal.ts,envelope.ts,padding.ts,route-token.ts,canonical.ts}`                                                                            |
| Implementation (runtime)  | `packages/sabcl/src/{catalog/capabilities.ts,replay/redis-replay-store.ts,server/,client/}`                                                                           |
| Implementation (router)   | `services/sabcl-router/src/routing/router.service.ts`                                                                                                                 |
| Implementation (callers)  | `apps/api-gateway/src/sabcl/`, `services/{identity,ledger,payments}/src/sabcl/`                                                                                       |
| Implementation (web)      | `apps/web/src/app/app/sabcl/page.tsx`, `src/components/sabcl/sabcl-status-panel.tsx`                                                                                  |
| Unit test (protocol)      | `seal.test.ts` (25), `leakage.test.ts` (8), `route-token.test.ts` (11), `padding.test.ts` (8)                                                                         |
| Unit test (crypto)        | `primitives.test.ts` (11), `keyring.test.ts` (10), `canonical.test.ts` (4)                                                                                            |
| Unit test (runtime)       | `capabilities.test.ts` (7), `environment.test.ts` (13), `sabcl-recipient.test.ts` (15)                                                                                |
| Unit test (router/edge)   | `router.service.spec.ts` (21), `ledger.client.sabcl.spec.ts` (8), `sabcl/v1.test.ts`                                                                                  |
| Unit test (web)           | `apps/web/src/components/sabcl/sabcl-status-panel.test.tsx` (11)                                                                                                      |
| Integration test          | `services/sabcl-router/test/router.integration-spec.ts` — real Redis replay state, 7 cases                                                                            |
| End-to-end test           | `services/sabcl-router/test/strict-mode.integration-spec.ts` — 8 cases over real sockets                                                                              |
| Browser test              | `none` functional; `apps/web/e2e/accessibility.spec.ts` drives `/app/sabcl` in EN, SI, TA                                                                             |
| CI step                   | `Test SABCL protocol, crypto, padding, rotation and route tokens`                                                                                                     |
| CI step (leakage)         | `Test SABCL metadata leakage against seeded sensitive values`                                                                                                         |
| CI step (router)          | `Test SABCL blind router routing, replay and rate limits`                                                                                                             |
| CI step (integration)     | `Test SABCL router with real Redis replay state`                                                                                                                      |
| CI step (end to end)      | `Test strict-mode encrypted end-to-end journey through the router`                                                                                                    |
| Documentation (protocol)  | [SABCL/1 protocol](../security/sabcl-protocol.md), [threat model](../security/sabcl-threat-model.md), [leakage](../security/sabcl-metadata-leakage.md)                |
| Documentation (operation) | [replay and expiry](../security/sabcl-replay-and-expiry.md), [key management](../security/sabcl-key-management.md), [routes](../security/sabcl-route-provisioning.md) |
| Documentation (runbook)   | [SABCL runbook](../security/sabcl-runbook.md), [ADR 0009](../decisions/0009-sabcl-privacy-and-secure-routing.md), [demo](../demo/sabcl-routing-demo.md)               |
| Command                   | `pnpm sabcl:test`, `pnpm sabcl:test:leakage`, `pnpm sabcl:test:router`                                                                                                |
| Command (Docker)          | `pnpm sabcl:test:integration`, `pnpm sabcl:test:e2e`; key material via `pnpm sabcl:keys`                                                                              |
| Status — development VM   | `PASS LOCALLY` (protocol, crypto, leakage, catalogue, router units, contract, component)                                                                              |
| Status — development VM   | Redis replay and the strict-mode journey `NOT RUN LOCALLY — Docker unavailable`                                                                                       |
| Status — GitHub Actions   | `PASS IN CI`                                                                                                                                                          |

Three router unit cases are worth naming, because they are what make "blind" a
testable word rather than a marketing one:
`cannot read the payload it forwards`,
`is not a generic proxy: no request shape names a destination`, and
`does not log the router private key or the route secret`. The replay store is
covered by `replay-store.test.ts` (5 cases) and, against real Redis, by
`shares replay state across router instances` and
`expires replay state so retention stays bounded by the message TTL`. The
accessibility run exercises `/app/sabcl` while the router is deliberately down,
at 320px and 1280px, and asserts the navigation link is reachable by tabbing and
activated with `Enter` — an outage page must remain operable, not only a healthy
one.

---

## 10–11. Threat detection and the operator console

Risk is deliberately deterministic. Integer-weight rules with persisted
explanations were chosen over a model because a prototype cannot honestly claim a
trained fraud model, and because an operator who cannot see why a control was
applied cannot responsibly release it. Every assessment stores its explanation;
every control is scoped and expiring; every incident and operator action is
append-only.

The architectural property that matters is that a control is enforced by whoever
is positioned to enforce it, not by Risk alone. The Gateway checks controls
before forwarding a confirmation —
`fails closed before step-up and Payments when an active control blocks confirmation`
in `apps/api-gateway/src/transfers/transfers.controller.spec.ts`. Payments checks
independently through `services/payments/src/transfers/risk.client.ts`. Identity
exposes an internal session-revocation route at
`services/identity/src/auth/sessions/session-control.controller.ts` that Risk
calls through `services/risk/src/controls/identity-control.client.ts`.

### 10. Risk

| Aspect                    | Artefact                                                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation (ingest)   | `services/risk/src/events/{event.service.ts,velocity.service.ts}`                                                                                                                      |
| Implementation (rules)    | `services/risk/src/assessments/{risk-engine.ts,assessment.service.ts}`                                                                                                                 |
| Implementation (controls) | `services/risk/src/controls/`, `src/incidents/`, `src/operators/`                                                                                                                      |
| Implementation (privacy)  | `services/risk/src/retention/retention.service.ts`, `src/reconciliation/`                                                                                                              |
| Implementation (enforce)  | `apps/api-gateway/src/risk/risk.client.ts`, `services/payments/src/transfers/risk.client.ts`                                                                                           |
| Unit test                 | `risk-engine.spec.ts` (25 cases), `retention.service.spec.ts`                                                                                                                          |
| Unit test (contract)      | `packages/contracts/src/risk/v1.test.ts`, `transfers.controller.spec.ts` fail-closed case                                                                                              |
| Integration / e2e test    | `services/risk/test/risk.integration-spec.ts` — five cases on real PostgreSQL and Redis                                                                                                |
| Browser test              | `apps/web/e2e/security-ops.spec.ts` — the `@functional` triage journey                                                                                                                 |
| CI step                   | `Test deterministic Risk rules, controls and retention units`                                                                                                                          |
| CI step (integration)     | `Test Risk PostgreSQL, Redis, ingestion and lifecycle integration`                                                                                                                     |
| CI step (reconciliation)  | `Reconcile Risk links and controls`                                                                                                                                                    |
| Documentation (rules)     | [rule catalogue](../security/risk-rule-catalogue.md), [event contract](../security/risk-event-contract.md), [control policy](../security/automated-control-policy.md)                  |
| Documentation (policy)    | [failure policy](../security/risk-failure-policy.md), [privacy and retention](../security/risk-privacy-and-retention.md), [threat model](../security/threat-detection-threat-model.md) |
| Documentation (design)    | [architecture](../architecture/threat-detection-and-controls.md), [ADR 0010](../decisions/0010-threat-detection-and-automated-controls.md), [demo](../demo/risk-controls-demo.md)      |
| Command                   | `pnpm risk:test`, then `pnpm risk:test:integration`; recovery via `pnpm risk:recover`                                                                                                  |
| Status — development VM   | `PASS LOCALLY` (units, contracts); the rest `NOT RUN LOCALLY — Docker unavailable`                                                                                                     |
| Status — GitHub Actions   | `PASS IN CI`                                                                                                                                                                           |

The integration cases are the substance of the claim:
`rejects source impersonation and idempotently accepts duplicate and out-of-order events`,
`atomically tracks velocity and persists explainable idempotent assessments`,
`applies, releases and expires scoped controls with append-only history`,
`enforces immutable original event facts`, and
`keeps subject assessments isolated and reconciles links`.

### 11. Security-operator console

| Aspect                  | Artefact                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Implementation (pages)  | `apps/web/src/app/security-ops/{page.tsx,sign-in/page.tsx,incidents/[incidentId]/page.tsx}`                                          |
| Implementation (parts)  | `src/components/security-ops/{operator-dashboard.tsx,operator-sign-in.tsx,incident-detail.tsx}`                                      |
| Implementation (data)   | `apps/web/src/lib/security-ops/{operator-client.ts,server-operator.ts}`                                                              |
| Implementation (edge)   | `apps/api-gateway/src/operators/operators.controller.ts`, `services/risk/src/operators/`                                             |
| Unit test               | `none` for the dashboard component; see the [recorded gaps](#recorded-gaps)                                                          |
| Unit test (authz)       | `apps/api-gateway/src/resilience/resilience.controller.spec.ts` covers the shared boundary                                           |
| Integration / e2e test  | `services/risk/test/risk.integration-spec.ts` — the control and incident lifecycle it drives                                         |
| Browser test            | `apps/web/e2e/security-ops.spec.ts` — one `@functional` triage journey, one `@a11y` check                                            |
| CI step                 | `Test real transfer Playwright journey and browser flows`                                                                            |
| CI step (accessibility) | `Test transfer accessibility including EN SI TA and mobile states`                                                                   |
| Documentation           | [operator authorization](../security/operator-authorization-model.md), [incident response](../security/incident-response-runbook.md) |
| Documentation (design)  | [architecture](../architecture/threat-detection-and-controls.md), [demo](../demo/risk-controls-demo.md)                              |
| Command                 | `pnpm web:test:e2e`                                                                                                                  |
| Status — development VM | `NOT RUN LOCALLY — Docker unavailable`                                                                                               |
| Status — GitHub Actions | `PASS IN CI`                                                                                                                         |

The browser journey asserts an unauthenticated visit is redirected to
`/security-ops/sign-in` before any risk data is fetched, then triages a seeded
critical incident, assigns an operator, resolves it with an audited reason,
drains every page of active controls — expanding the paginated list first, and
asserting the list shrinks on each release rather than waiting on a timeout — and
ends on `No active controls.` at a 390px viewport with no horizontal scroll.

---

## 12–15. Operational resilience

Backup and restore are operator command-line tooling, never an HTTP endpoint.
That is a security decision, not an oversight: a web button that runs a restore
is a web button that can be tricked into running one. The recovery console
therefore _reads_ evidence and _acknowledges_ a failed drill; it starts nothing.
`apps/web/e2e/resilience.spec.ts` enforces that by enumerating every button on
the page and asserting none says `run backup` or `restore now`.

The backup scope is the five PostgreSQL databases named in `BACKUP_SCOPE` at
`services/resilience/scripts/dr-lib.mjs:53` — identity, ledger, payments, risk
and resilience. Redis is deliberately excluded: its cache, replay and velocity
state is recreatable, and restoring a stale replay window would be worse than
having none.

One rule runs through all of it: **a disaster-recovery command must never guess
which bytes it examined.** A bare `pnpm dr:backup:verify` or
`pnpm dr:restore:verify` fails. The set is named with `--set <backup-set-id>`, or
explicitly requested with `--latest`, and `--latest` chooses by the manifest's
`createdAt` rather than by directory name, treating two sets that share the
newest timestamp as an error rather than a coin toss. CI asserts those refusals
against a real set in the step
`Refuse a bare, ambiguous or unknown backup selection`, which fails the build if
a bare verify succeeds, if an unknown identifier is accepted, or if a
path-shaped identifier such as `../../etc/passwd` is accepted.

### 12. Encrypted backup

| Aspect                  | Artefact                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Implementation          | `services/resilience/scripts/backup.mjs` — stage, dump, encrypt, checksum, manifest, rename                                |
| Implementation (shared) | `services/resilience/scripts/dr-lib.mjs` — scope, key loading, argument arrays, redaction                                  |
| Implementation (crypto) | `packages/contracts/src/resilience/backup-crypto.ts` — AES-256-GCM, per-file nonce, canonical manifest                     |
| Implementation (verify) | `services/resilience/scripts/{backup-verify.mjs,backup-negative.mjs}`                                                      |
| Unit test (tooling)     | `services/resilience/scripts/dr-lib.test.mjs` — 27 cases                                                                   |
| Unit test (crypto)      | `packages/contracts/src/resilience/backup-crypto.test.ts` — 14 cases                                                       |
| Unit test (config)      | `services/resilience/src/common/config/resilience.config.spec.ts` — 8 cases                                                |
| Integration / e2e test  | `services/resilience/test/resilience.integration-spec.ts` — idempotent recording, fixed identity                           |
| Browser test            | `none` by design; the console's read-only view is covered by `apps/web/e2e/resilience.spec.ts`                             |
| CI step                 | `Test Resilience units, failure policy and backup tooling refusals`                                                        |
| CI step (real set)      | `Create an encrypted backup set and verify it by explicit identifier`                                                      |
| CI step (refusals)      | `Refuse a bare, ambiguous or unknown backup selection`                                                                     |
| CI step (negative)      | `Refuse tampered, wrong-key, incomplete and unsafe backup sets`                                                            |
| CI step (cleanup)       | `Remove backup working directory and assert no plaintext remains`                                                          |
| Documentation           | [backup encryption and key management](../security/backup-encryption-and-key-management.md)                                |
| Documentation (policy)  | [retention and disposal](../security/backup-retention-and-disposal.md), [runbook](../operations/backup-restore-runbook.md) |
| Command                 | `pnpm dr:backup`, then `pnpm dr:backup:verify -- --set <backup-set-id>`                                                    |
| Command (negative)      | `pnpm dr:backup:verify:negative -- --set <backup-set-id>`                                                                  |
| Status — development VM | `PASS LOCALLY` (tooling refusals, crypto, configuration)                                                                   |
| Status — development VM | A real set against live databases is `NOT RUN LOCALLY — Docker unavailable`                                                |
| Status — GitHub Actions | `PASS IN CI`                                                                                                               |

The tooling cases are why this row is trustworthy even without Docker:
`a manifest entry may name a file, never a path`,
`a set that names the same service twice is rejected`,
`a set missing a service in scope is incomplete, not partially usable`,
`a tampered ciphertext fails the checksum before any decryption`,
`a symbolic link inside a set is refused`,
`redaction removes credentials from anything that could be logged`, and
`two sets sharing the newest timestamp fail rather than pick one`. The crypto
suite adds `every file uses a fresh nonce, so ciphertext never repeats`,
`a tampered header is rejected before decryption is attempted` and
`the ciphertext does not contain the plaintext`. Checksums are verified _before_
decryption is attempted, so a corrupted set is diagnosed without feeding
attacker-controlled bytes to a cipher. A set is published atomically: everything
is staged in a temporary directory and renamed into place only once every dump
has been taken, encrypted, checksummed and listed, so a reader never sees a
half-written set that would restore an inconsistent platform.

### 13. Restore verification

| Aspect                  | Artefact                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Implementation          | `services/resilience/scripts/restore-verify.mjs`                                                                                   |
| Unit test               | `services/resilience/scripts/dr-lib.test.mjs` — set resolution, selection parsing, safe targets                                    |
| Unit test (crypto)      | `packages/contracts/src/resilience/backup-crypto.test.ts` — the decryption path a restore uses                                     |
| Integration / e2e test  | Exercised in CI as the real thing, against a set produced from live PostgreSQL                                                     |
| Browser test            | `none` — no browser control performs a restore, and the console test asserts that                                                  |
| CI step                 | `Verify an isolated restore into disposable databases`                                                                             |
| Documentation           | [backup and restore runbook](../operations/backup-restore-runbook.md)                                                              |
| Documentation (threat)  | [DR threat model](../security/disaster-recovery-threat-model.md), [architecture](../architecture/operational-resilience-and-dr.md) |
| Command                 | `pnpm dr:restore:verify -- --set <backup-set-id>`                                                                                  |
| Status — development VM | `PASS LOCALLY` (selection and safety units); the restore `NOT RUN LOCALLY — Docker unavailable`                                    |
| Status — GitHub Actions | `PASS IN CI`                                                                                                                       |

Every restore target is a freshly created database with a generated name. The
live database names are read from `BACKUP_SCOPE` and checked against the targets
before a single byte is restored, and there is no flag, environment variable or
argument that can redirect the tool onto a live database — overwriting one is
simply not an operation it supports. `--set` names which backup to _read_, never
where to _write_. Temporary databases and decrypted material are removed in a
`finally` block, so a failure mid-restore leaves no plaintext dump and no
half-restored database behind. The unit suite pins the surrounding safety
properties: `a set identifier is an opaque token, never a path` and
`connection parsing refuses anything that is not a PostgreSQL database`.

### 14. Disaster-recovery drill

| Aspect                   | Artefact                                                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation           | `services/resilience/scripts/drill.mjs` — backup, verify, restore, reconcile, record, clean up                                                                              |
| Implementation (service) | `services/resilience/src/drills/{drill.service.ts,drill.controller.ts}`                                                                                                     |
| Implementation (schema)  | `services/resilience/prisma/migrations/20260801210000_resilience_recovery_drills/`                                                                                          |
| Unit test (config)       | `services/resilience/src/common/config/resilience.config.spec.ts` — 8 cases                                                                                                 |
| Unit test (contract)     | `packages/contracts/src/resilience/v1.test.ts` — 12 cases                                                                                                                   |
| Unit test (tooling)      | `services/resilience/scripts/dr-lib.test.mjs`                                                                                                                               |
| Integration / e2e test   | `services/resilience/test/resilience.integration-spec.ts` — 10 cases                                                                                                        |
| Browser test             | `apps/web/e2e/resilience.spec.ts` seeds a failed drill and acknowledges it through the prompt                                                                               |
| CI step                  | `Test Resilience PostgreSQL append-only drill evidence`                                                                                                                     |
| CI step (drill)          | `Run the deterministic disaster-recovery drill`                                                                                                                             |
| Documentation            | [DR runbook](../operations/disaster-recovery-runbook.md), [DR threat model](../security/disaster-recovery-threat-model.md)                                                  |
| Documentation (design)   | [architecture](../architecture/operational-resilience-and-dr.md), [ADR 0011](../decisions/0011-operational-resilience-and-dr.md), [demo](../demo/disaster-recovery-demo.md) |
| Command                  | `pnpm dr:drill`                                                                                                                                                             |
| Status — development VM  | `PASS LOCALLY` (configuration, contract, tooling); the drill `NOT RUN LOCALLY — Docker unavailable`                                                                         |
| Status — GitHub Actions  | `PASS IN CI`                                                                                                                                                                |

Every step reports its outcome to the Resilience service, so the evidence lands
in append-only drill history rather than only in a CI log. The drill fails, and
fails loudly, when a dump is missing, a checksum differs, ciphertext is tampered
with, the key is wrong, a service is absent from the set, reconciliation fails or
cleanup fails — the conditions under which a real recovery would not work, and
therefore the conditions a passing drill must not be allowed to pass through. The
database enforces the same honesty:
`refuses a transition that would misrepresent what was proven`,
`keeps drill history append-only`,
`acknowledges a failed drill once, and only a failed drill`, and
`never returns a database URL, token or key in recovery evidence`.

### 15. Recovery operations console

| Aspect                   | Artefact                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Implementation           | `apps/web/src/app/security-ops/resilience/page.tsx`, `src/components/security-ops/recovery-console.tsx`     |
| Implementation (edge)    | `apps/api-gateway/src/resilience/{resilience.controller.ts,resilience.client.ts}`                           |
| Implementation (service) | `services/resilience/src/drills/drill.controller.ts`                                                        |
| Unit test (web)          | `apps/web/src/components/security-ops/recovery-console.test.tsx` — 18 cases                                 |
| Unit test (edge)         | `resilience.controller.spec.ts` (9 cases), `resilience.client.spec.ts` (9 cases)                            |
| Integration / e2e test   | `services/resilience/test/resilience.integration-spec.ts` — stable-cursor history, warnings                 |
| Browser test             | `apps/web/e2e/resilience.spec.ts` — one `@functional` journey and one `@a11y` check                         |
| CI step                  | `Test web transfer components including polling and idempotency`; `Test API Gateway`                        |
| CI step (browser)        | `Test real transfer Playwright journey and browser flows`                                                   |
| Documentation            | [recovery operator authorization](../security/recovery-operator-authorization.md)                           |
| Documentation (design)   | [architecture](../architecture/operational-resilience-and-dr.md), [demo](../demo/disaster-recovery-demo.md) |
| Command                  | `pnpm web:test`, then `pnpm web:test:e2e`                                                                   |
| Status — development VM  | `PASS LOCALLY` (component and Gateway units); browser `NOT RUN LOCALLY — Docker unavailable`                |
| Status — GitHub Actions  | `PASS IN CI`                                                                                                |

The console reuses the Risk service's operator session store rather than
introducing a second one, because two session stores means two places to get
expiry, revocation and CSRF wrong. The component suite holds it to the language
it must use — `labels measurements as prototype figures rather than objectives` —
and to what it must never print:
`never renders a URL, password, key, dump path or customer reference`,
`abbreviates the manifest checksum instead of printing all 64 characters`, and
`offers no control that runs a backup or a restore`. The Gateway client is held
to a matching failure policy: it
`collapses an upstream 500 to an unavailable state with no upstream detail` while
preserving a conflict and a not-found, so a stale bookmark does not read as an
outage. The browser test then scans the rendered markup for `postgresql://`,
`PGPASSWORD`, `DR_BACKUP_ENCRYPTION_KEY`, `.dump.enc` and
`x-aegis-internal-token`.

---

## 16–17. Cross-cutting assurance

### 16. Reconciliation

Reconciliation answers a question no individual test can: after everything the CI
job did — transfers, channel postings, risk controls, a restore, a drill — is the
platform still internally consistent? It runs four ways and then once in
aggregate, and the aggregate must agree with the individual runs.

Ledger and Payments reconcile directly against their databases. Risk and
Resilience reconcile through an authenticated call to the running service, so
they recompute state behind their own internal-token boundary rather than
reaching into a schema they do not own — which is why the CI steps start those
two services first and shut them down from a shell `trap`.

| Aspect                  | Artefact                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Implementation          | `infra/scripts/reconcile-all.mjs`                                                                                                    |
| Implementation (ledger) | `services/ledger/src/reconciliation/reconciliation.service.ts`, `services/ledger/scripts/reconcile.mjs`                              |
| Implementation (pay)    | `services/payments/src/reconciliation/payments-reconciliation.service.ts`, `scripts/reconcile.mjs`                                   |
| Implementation (risk)   | `services/risk/src/reconciliation/`, `services/risk/scripts/reconcile.mjs`                                                           |
| Implementation (resil.) | `services/resilience/src/reconciliation/`, `services/resilience/scripts/reconcile.mjs`                                               |
| Unit test               | `infra/scripts/reconcile-all.test.mjs` — 12 cases                                                                                    |
| Unit test (ledger)      | `services/ledger/src/reconciliation/reconciliation.spec.ts`                                                                          |
| Integration test        | `ledger.integration-spec.ts` and `payments.integration-spec.ts` reconciliation blocks                                                |
| Integration test        | `risk.integration-spec.ts`, `resilience.integration-spec.ts` append-only result history                                              |
| Browser test            | `none` — reconciliation has no browser surface                                                                                       |
| CI step                 | `Test infrastructure, environment, demo, reconcile and evidence tooling`                                                             |
| CI step (restart)       | `Restart infrastructure for reconciliation`                                                                                          |
| CI step (run)           | `Reconcile Ledger and Payments`; `Reconcile Risk links and controls`                                                                 |
| CI step (aggregate)     | `Aggregate reconciliation across Ledger, Payments, Risk and Resilience`                                                              |
| Documentation           | [risk reconciliation and recovery](../security/risk-reconciliation-guide.md)                                                         |
| Documentation (design)  | [ledger integrity model](../security/ledger-integrity-model.md), [service failure runbook](../operations/service-failure-runbook.md) |
| Command                 | `pnpm reconcile:all`                                                                                                                 |
| Command (individual)    | `pnpm ledger:reconcile`, `pnpm payments:reconcile`, `pnpm risk:reconcile`, `pnpm resilience:reconcile`                               |
| Status — development VM | `PASS LOCALLY` (the aggregation tooling suite); real runs `NOT RUN LOCALLY — Docker unavailable`                                     |
| Status — GitHub Actions | `PASS IN CI`                                                                                                                         |

The aggregation suite is unusually strict about its own output, because a
reconciliation report that leaked a connection string would be a security
incident produced by a security tool. It asserts
`credentials in raw output are redacted before parsing`,
`fields outside the allow list never reach the summary`, and
`a report never contains a value that was redacted out of the output`. It also
asserts operational honesty:
`one failure does not stop the run, and every individual result survives`,
`a real child that exceeds its timeout is killed and reported`, and
`the exit code is non-zero when any reconciliation fails`. The detection claims
are proved by deliberately breaking things —
`detects a deliberately corrupted balance projection` in the Ledger and
`reconciles valid state and detects a deliberate completed-state violation` in
Payments.

### 17. Accessibility

Accessibility is a release constraint here rather than a polish item, and the
tests reflect that. The threshold is no serious or critical axe violation,
checked at each step of a real journey rather than on a static page: the landing
page, sign-in, all four onboarding steps, the empty workspace, the dashboard with
and without activity, empty and filtered transaction history, the transaction
record, security settings, the SABCL status page while the router is down, the
transfer list, the transfer form, the masked preview with PIN confirmation,
operator sign-in and dashboard, and the recovery console.

The suite also checks what an axe scan cannot: that the SABCL navigation link is
reachable by tabbing and activated with `Enter` rather than requiring a pointer,
that the page body does not scroll horizontally at 320px, and that Sinhala and
Tamil render without silently falling back to English.

| Aspect                  | Artefact                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Implementation (i18n)   | `apps/web/src/lib/i18n/{dictionaries.ts,language-provider.tsx,server.ts}`                                             |
| Implementation (shell)  | `src/components/layout/{language-selector.tsx,auth-shell.tsx,authenticated-shell.tsx}`                                |
| Implementation (states) | `apps/web/src/components/ui/{feedback.tsx,service-unavailable.tsx}`                                                   |
| Implementation (forms)  | `apps/web/src/components/auth/{authentication-stepper.tsx,fields.tsx}`                                                |
| Unit test               | `apps/web/src/lib/i18n/dictionaries.test.tsx` — dictionary completeness, document `lang`                              |
| Unit test (components)  | `authenticated-shell.test.tsx`, `session-card.test.tsx`, `sabcl-status-panel.test.tsx`                                |
| Integration / e2e test  | `none` separate; accessibility is asserted against the running stack, not in isolation                                |
| Browser test            | `apps/web/e2e/accessibility.spec.ts` — the `@a11y` authentication and account surfaces run                            |
| Browser test (ops)      | `security-ops.spec.ts` and `resilience.spec.ts` `@a11y` cases                                                         |
| CI step                 | `Install Playwright Chromium`                                                                                         |
| CI step (run)           | `Test transfer accessibility including EN SI TA and mobile states`                                                    |
| Documentation           | [ADR 0005](../decisions/0005-authentication-user-experience.md) — WCAG-oriented accessibility as a release constraint |
| Documentation (guide)   | [architecture](../architecture/README.md), [user guide](../../USER_GUIDE.md)                                          |
| Command                 | `pnpm web:test:a11y`                                                                                                  |
| Status — development VM | `PASS LOCALLY` (dictionary and component units); axe runs `NOT RUN LOCALLY — Docker unavailable`                      |
| Status — GitHub Actions | `PASS IN CI`                                                                                                          |

---

## Recorded gaps

Every `none` above, collected honestly in one place. None is a defect in shipped
behaviour; each is a place where the evidence is thinner than elsewhere, and a
reader is entitled to know which.

| Capability                 | Gap                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| QR Pay                     | The six unit cases cover issue, preview, self-transfer, expiry and tampering, but not nonce replay. |
| USSD                       | One unit case covers the menu walk; none is named for session expiry or webhook authentication.     |
| USSD                       | `USSD_PROVIDER_SECRET` is required by `pnpm env:check` but is not read by `payments.config.ts`.     |
| QR / USSD / Agent Cash     | No dedicated PostgreSQL integration suite and no functional Playwright journey.                     |
| Inclusive channels         | `packages/contracts/src/channels/v1.ts` has no `v1.test.ts`, unlike the other contract modules.     |
| SABCL                      | No functional Playwright journey drives an encrypted call from the browser.                         |
| Security-operator console  | No component unit test for `operator-dashboard.tsx`.                                                |
| Backup, restore, reconcile | No browser test.                                                                                    |

What covers each risk instead:

- **QR replay.** Rejection is implemented in
  `services/payments/src/qr/qr.service.ts`: the nonce hash is looked up, a
  redeemed dynamic code raises `QR_ALREADY_REDEEMED`, and a repeated redemption
  returns the existing record rather than posting twice. It is exercised through
  the channel path, but no unit case is named for it.
- **USSD expiry and webhook.** Expiry is the five-minute Redis TTL at
  `ussd.service.ts:164`. The webhook sits behind the service-wide
  `InternalTokenGuard` on a loopback-bound port with no browser CORS. The
  `USSD_PROVIDER_SECRET` variable is validated so a deployment cannot ship
  without one, but no code path currently consumes it — stated here rather than
  left to imply a per-request provider signature that does not exist.
- **Channel database and browser coverage.** The database objects the channels
  write are covered by the Identity, Ledger and Payments migration and posting
  suites
  (`20260801123023_p08_channel_journal_types`,
  `20260801150000_p08_qr_agent_models`, `20260801122952_p08_agent_models`).
  `apps/web/e2e/evidence.spec.ts` renders all three channel pages at desktop and
  mobile viewports and fails the run if any renders a one-time code, PIN, session
  cookie, CSRF value, internal or bearer token, connection string, private key or
  full account reference.
- **Channel contract tests.** The channel schemas are parsed at the Gateway
  boundary in `apps/api-gateway/src/channels/channels.controller.ts`, so a shape
  violation is rejected in the running system; it is simply not pinned by a
  contract unit test.
- **SABCL browser coverage.** The equivalent proof is stronger and lives lower
  down: `strict-mode.integration-spec.ts` runs the full encrypted path over real
  sockets, including replay refusal, tamper refusal at the recipient, capability
  scope refusal, refusal to reveal whether a resource exists, and no plaintext
  fallback. The browser evidence covers the operator status page.
- **Operator dashboard unit test.** The authorization decisions it depends on —
  session, role, CSRF, and taking the operator identity from the session and
  never from the request body — are unit-tested at the Gateway, and the whole
  triage journey runs end to end in Chromium.
- **No browser test for backup, restore or reconciliation.** Deliberate. These
  are command-line tools with no browser surface, and
  `apps/web/e2e/resilience.spec.ts` actively asserts the console offers no button
  that runs a backup or a restore.

---

## Reproducing this audit

Nothing here needs to be taken on trust. On a Docker-capable machine:

```bash
pnpm install --frozen-lockfile
pnpm env:init:local          # generates a local .env; refuses to overwrite
pnpm env:check               # names any missing variable, never prints a value
pnpm infra:validate
pnpm demo:start
pnpm demo:status
pnpm demo:verify
```

Then run any command in the tables above. The command surface is itself tested:
`infra/scripts/docs.test.mjs` fails the build if a documented `pnpm` command does
not exist in `package.json`, if a release document is missing, or if a relative
markdown link points at a file that is not there. It runs in CI as
`Validate documented commands and release documents`.

On a machine without Docker, the honest subset is:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

`pnpm test` runs the infrastructure and documentation tooling suites through
`node --test "infra/scripts/*.test.mjs"`, then every workspace test task through
Turborepo.

---

## What this audit does not claim

This is a hackathon prototype, not a production banking system. Read every
capability table above with the following in force, and treat any reading that
contradicts them as wrong.

- **No production multi-region disaster recovery.** The drill runs against local
  disposable infrastructure on one machine.
- **No continuous replication and no zero data loss.** Recovery is from a
  point-in-time encrypted backup set.
- **No guaranteed recovery-point or recovery-time objective.** The console and
  the drill report a _measured prototype recovery-point age_ and a _measured
  prototype recovery duration_, and `apps/web/e2e/resilience.spec.ts` asserts the
  interface uses exactly that language rather than presenting them as objectives.
- **No protection against the loss of a cloud region or provider.**
- **No compliance certification** of any kind.
- **No trained fraud model.** Risk is deterministic integer-weight rules with
  persisted explanations, which is a different and more modest claim.
- **No production workforce identity.** `RISK_OPERATOR_BOOTSTRAP_TOKEN` is a
  development bootstrap that Risk refuses in production; a real deployment must
  bind the same short-lived session contract to an approved identity provider
  with multi-factor authentication.
- **No external payment rails and no production messaging.** Every channel
  terminates inside this platform.
- **Synthetic data only.** Never real money, never real credentials. Every phone
  number, PIN and reference in these suites is a fixture.

Two operational cautions belong beside those limits. `pnpm demo:reset -- --yes`
destroys local volumes, and requires that explicit confirmation for a reason. And
`pnpm demo:evidence` writes synthetic screenshots into the git-ignored
`.evidence/` directory, which the tooling neither commits nor uploads and which a
human must review before anything is shared.
