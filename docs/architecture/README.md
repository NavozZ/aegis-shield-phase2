# Architecture Documentation

This document describes the implemented boundaries of the completed platform:
authentication, the immutable ledger, dashboard and transaction history, secure
transfers, inclusive payment channels, SABCL metadata-protected routing,
deterministic threat detection with scoped controls, and operational resilience
with encrypted backup and disaster-recovery drills. Architecture changes must
preserve explicit trust boundaries, data ownership, and bounded failure
behaviour.

Transaction history is derived from immutable postings. The Ledger calculates each liability-account balance in `createdAt ASC, id ASC` chronology before applying display filters, then presents rows by `postedAt DESC, UUID DESC`. `effectiveAt` describes business effect and never changes posting sequence. Versioned opaque cursors are bounded and cryptographically fingerprinted to direction, category, and date filters. Ownership is included in the account query so foreign and nonexistent resources share the same 404 response.

## Current monorepo boundaries

```text
apps/       Independently runnable user-facing and gateway applications
services/   Six independently deployable services, all implemented
packages/   Shared versioned contracts and the SABCL protocol package
infra/      Local data orchestration, stack process management, and checks
docs/       Architecture, decisions, security, operations and demonstrations
```

pnpm provides one workspace and root lockfile. Turborepo coordinates tasks without changing application ownership.

## Implemented stack and ports

| Component    | Port | Owns                                                     |
| ------------ | ---- | -------------------------------------------------------- |
| Web          | 3000 | Multilingual customer UI and the operator consoles       |
| API Gateway  | 4000 | The only public HTTP surface; cookies, CSRF, rate limits |
| Identity     | 4101 | Users, OTP, PIN, passkeys, sessions                      |
| Ledger       | 4102 | Accounts, immutable journals, balances                   |
| SABCL router | 4103 | Blind routing of encrypted envelopes it cannot read      |
| Payments     | 4104 | Transfers, QR, USSD, agent cash, idempotency             |
| Risk         | 4105 | Security events, assessments, controls, incidents        |
| Resilience   | 4106 | Recovery drill evidence and backup-set registry          |
| PostgreSQL   | 5432 | Five service databases, one least-privilege role each    |
| Redis        | 6379 | Sessions, challenges, velocity and replay state          |

Every service except the Gateway and the Web application is bound to loopback and
carries no browser CORS. The SABCL router starts only when `SABCL_MODE` is not
`off`.

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

## SABCL blind router responsibility

`services/sabcl-router` is loopback-bound on port 4103 with no browser CORS and
no internal-token guard. It owns exactly one decision: which allowlisted
destination an opaque route token resolves to.

It holds no recipient decryption key, so the payloads it forwards are opaque
bytes to that process by construction rather than by policy. It verifies
structure — version, freshness, sender-key allowlist, hop budget, rate limit,
route resolution and replay — and forwards the envelope unchanged. It does not
verify signatures; the recipient does, so a compromised router that lied about
authenticity would be caught at the far end.

It is the least-trusted server-side element in the system, which is the point:
it must be able to route and must not be able to read. See
[ADR 0009](../decisions/0009-sabcl-privacy-and-secure-routing.md).

## Resilience service responsibility

`services/resilience` is loopback-bound on port 4106 with no browser CORS. An
internal or per-source token protects every route except liveness and readiness.
It owns the `aegis_resilience` database and `app` schema, and records recovery
**evidence** only: which encrypted backup sets exist, which drills ran, what they
measured, and what an operator said about a failure.

It holds no customer data, no balances and no dump contents, and it never holds
the backup encryption key — it validates that one is configured and records only
that boolean.

There is no route that runs a backup, runs a restore, executes a shell command,
accepts a filesystem path or accepts a database connection string. Backup and
restore are operator command-line tooling, because an endpoint that shelled out
to `pg_dump` would be remote command execution behind a console login. See
[ADR 0011](../decisions/0011-operational-resilience-and-dr.md) and
[operational resilience and DR](./operational-resilience-and-dr.md).

## Future independent service boundaries

- notifications
- production observability and audit integrity

Each stateful service will own its data store and publish explicit contracts. Shared packages may contain schemas and utilities, but never direct cross-service database access. The local data infrastructure models that ownership with separate identity, ledger, payments, audit and resilience databases, each with its own login role, inside one local PostgreSQL container.

## Current and future data flow

```text
Browser → Next.js UI assets and protected server rendering
Browser → NestJS API Gateway authentication and account routes (credentialed CORS)
Next.js server → NestJS API Gateway session and account routes (session cookie only)
NestJS API Gateway → SABCL blind router → allowlisted Identity API   (encrypted envelope)
NestJS API Gateway → SABCL blind router → allowlisted Ledger API     (encrypted envelope)
NestJS API Gateway → SABCL blind router → allowlisted Payments API   (encrypted envelope)
Identity → Identity-owned PostgreSQL app schema
Identity → Identity Redis namespace
Ledger  → Ledger-owned PostgreSQL app schema
SABCL router → Redis replay namespace (aegis:sabcl:)
NestJS API Gateway → Resilience internal routes (gateway source token)
Resilience → Resilience-owned PostgreSQL app schema
Operator CLI → pg_dump / pg_restore / psql → every service database
```

When `SABCL_MODE=off` the Gateway calls each service directly with an internal
token, as it did before SABCL was introduced. When SABCL is configured, those calls are
encrypted before the router sees them, and in `strict` mode there is no other
path — a router outage is an outage, never a plaintext retry.

The browser never calls Identity or the Ledger directly. The Gateway sets the HttpOnly session and readable double-submit CSRF cookies, validates the exact configured web origin, and normalizes public errors. Next.js receives only safe session and account fields when rendering protected pages. Transfers, payments and all other service connections remain deferred.

## Money representation

Every monetary amount is an integer count of minor units: `BIGINT` in PostgreSQL, `BigInt` in the Ledger service, and a decimal string in every contract and JSON payload. No JavaScript number and no floating-point column holds money at any layer.

## Local data and messaging boundaries

PostgreSQL provides five logically isolated prototype databases — identity, ledger, payments, audit (owned by Risk) and resilience — each with its own least-privilege login role. Redis stores bounded, recreatable state for:

- sessions
- OTP and passkey challenges
- resend, request, and login limits

Ledger idempotency is stored in PostgreSQL rather than Redis, because an idempotent financial result must be durable and must commit in the same transaction as the work it protects.

Queues, production service messaging, deployment manifests, workload identity, and observability backends remain deferred.

## SABCL-protected communication flow

```text
Browser
   │  authenticated request, session cookie + CSRF
   ▼
API Gateway ─────────────────────────────────────────────── trusted, holds keys
   │  1. authenticate, validate, derive the customer from the session
   │  2. choose a capability  (ledger.accounts)
   │  3. SEAL: X25519 → HKDF-SHA-256 → AES-256-GCM, then Ed25519 sign
   │
   │  sealed envelope: version, random id, opaque route token, key ids,
   │  ephemeral public key, times, nonce, hop limit, padding bucket,
   │  ciphertext, tag, signature
   ▼
SABCL blind router :4103 ──────────────────────── SEMI-TRUSTED: routes, cannot read
   │  size → schema → expiry → sender allowlist → hop budget → rate limit
   │  → route token resolves to an allowlisted destination
   │  → replay claim in Redis (SET NX EX, atomic across instances)
   │  forwards the same bytes; holds no key that opens them
   ▼
Recipient service ────────────────────────────────────────── trusted, holds keys
   │  verify Ed25519 signature → derive key → AES-GCM open → own replay claim
   │  → check the path against the capability allowlist
   │  → dispatch on loopback with the internal token, so every existing
   │    guard, pipe, filter and contract check runs unchanged
   ▼
Identity / Ledger / Payments internal routes → PostgreSQL
```

The response returns sealed on the same path, correlated by the request's opaque
message identifier.

Capabilities: `identity.step-up`, `ledger.accounts`, `ledger.postings`,
`payments.transfer`. Reads and postings are separate so one token cannot both
list accounts and move money. Reconciliation, recovery, journal entries and every
browser-driven authentication flow have no SABCL route at all — including every
Resilience route, which the Gateway reaches directly with its own source token.

Full specification: [sabcl-protocol.md](../security/sabcl-protocol.md).

## Future diagrams and flows

The following remain to be completed as their implementations are introduced:

- context and container diagrams
- production workload-authentication flow
- external/QR payment flows
- transaction history and statement flow
- failure isolation flow beyond the implemented dependency-degradation policy

## Recovery flow

Backup and restore run outside the request path entirely. The CLI dumps each
authoritative database, encrypts it with AES-256-GCM, publishes the set
atomically, and reports identifiers, checksums and measurements to the Resilience
service — which records them in append-only, transition-validated evidence.
Restore verification creates freshly named disposable databases, proves the
restore, and drops them; it can never target a live service database. Redis is
deliberately out of scope, so sessions do not survive a restore. See
[operational resilience and DR](./operational-resilience-and-dr.md).

## Transfer flow

`Browser → Gateway → Identity` performs session and fresh PIN step-up; the PIN stops there. Gateway then sends a session-derived customer, opaque intent, and idempotency key to Payments. Payments owns limits and lifecycle state, while `Payments → Ledger` posts the sole balance-changing `CUSTOMER_TRANSFER` journal. Ledger locks both accounts in deterministic order and writes one debit plus one credit. A lost response remains `PROCESSING`; recovery repeats the same Ledger command and reconciliation compares both service views. See [ADR 0008](../decisions/0008-secure-customer-transfers.md).
