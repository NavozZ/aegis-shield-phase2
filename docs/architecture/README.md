# Architecture Documentation

This document describes the currently implemented Prompt 05 authentication and ledger boundaries and reserves the flows that later milestones must define. Architecture changes must preserve explicit trust boundaries, data ownership, and bounded failure behavior.

## Current monorepo boundaries

```text
apps/       Independently runnable user-facing and gateway applications
services/   Independently deployable services; Identity and Ledger are implemented
packages/   Shared versioned contracts; authentication and accounts v1 are implemented
infra/      Local data orchestration, stack process management, and checks
docs/       Architecture, decisions, and demonstration procedures
```

pnpm provides one workspace and root lockfile. Turborepo coordinates tasks without changing application ownership.

## Web application responsibility

`apps/web` is the Next.js customer experience boundary. It owns multilingual presentation, accessible multi-step flow state, browser WebAuthn ceremonies, safe API integration, and server-aware protected-route checks. Sensitive onboarding and fallback values remain in React memory and are cleared on reload or completion. It renders a minimal account summary from Gateway-validated data but owns no authentication policy, ledger state, or authoritative banking records.

## API gateway responsibility

`apps/api-gateway` is the public NestJS HTTP entry point. It preserves `GET /health`, adds dependency readiness and allowlisted `/api/v1/auth/*` and `/api/v1/accounts` routes, validates shared contracts, applies bounded request handling, and owns browser cookie and double-submit CSRF enforcement.

For account routes the Gateway resolves the acting customer from a session validated by Identity and passes that identifier to the Ledger internally. A customer identifier supplied in a request body, query string or header is never used. It exposes no route that posts a journal entry.

The Gateway does not own credentials, user records, sessions, or banking state and is not a generic proxy.

## Identity responsibility

`services/identity` is loopback-bound with no browser CORS. An internal token protects every route except liveness. Identity owns Tier-0 onboarding, hashed OTP challenges, Argon2id PIN verification, passkey public credentials/counters, revocable opaque sessions, and safe authentication events. PostgreSQL holds durable identity records; Redis holds expiring challenge and session state.

## Ledger responsibility

`services/ledger` is loopback-bound with no browser CORS. An internal token protects every route except liveness. It owns customer accounts, the chart of ledger accounts, immutable journal entries and postings, balance projections, idempotency records and reconciliation runs, in the `aegis_ledger` database and `app` schema.

The Ledger performs no authentication and duplicates no Identity logic. Money is stored as integer minor units and crosses every boundary as a decimal string. Customer wallets are liabilities of the platform. Integrity is enforced by database constraints and triggers, not only by application code — see [ledger-integrity-model.md](../security/ledger-integrity-model.md).

## Future independent service boundaries

- payments
- threat-detection
- sabcl-proxy
- notifications
- recovery

Each stateful service will own its data store and publish explicit contracts. Shared packages may contain schemas and utilities, but never direct cross-service database access. Prompt 02 models that ownership with separate identity, ledger, payments, and audit databases and login roles inside one local PostgreSQL container.

## Current and future data flow

```text
Browser → Next.js UI assets and protected server rendering
Browser → NestJS API Gateway authentication and account routes (credentialed CORS)
Next.js server → NestJS API Gateway session and account routes (session cookie only)
NestJS API Gateway → allowlisted Identity API (internal token)
NestJS API Gateway → allowlisted Ledger API (internal token, session-derived customer)
Identity → Identity-owned PostgreSQL app schema
Identity → Identity Redis namespace
Ledger  → Ledger-owned PostgreSQL app schema
```

The browser never calls Identity or the Ledger directly. The Gateway sets the HttpOnly session and readable double-submit CSRF cookies, validates the exact configured web origin, and normalizes public errors. Next.js receives only safe session and account fields when rendering protected pages. Transfers, payments and all other service connections remain deferred.

## Money representation

Every monetary amount is an integer count of minor units: `BIGINT` in PostgreSQL, `BigInt` in the Ledger service, and a decimal string in every contract and JSON payload. No JavaScript number and no floating-point column holds money at any layer.

## Local data and messaging boundaries

PostgreSQL provides four logically isolated prototype databases. Identity and the Ledger now use their own service databases and roles, while Redis stores bounded authentication state for:

- sessions
- OTP and passkey challenges
- resend, request, and login limits

Ledger idempotency is stored in PostgreSQL rather than Redis, because an idempotent financial result must be durable and must commit in the same transaction as the work it protects.

Queues, production service messaging, deployment manifests, workload identity, and observability backends remain deferred.

## Future diagrams and flows

The following remain to be completed as their implementations are introduced:

- context and container diagrams
- production workload-authentication flow
- idempotent transfer flow between two customer wallets
- transaction history and statement flow
- SABCL-protected communication flow
- failure isolation and recovery flow
