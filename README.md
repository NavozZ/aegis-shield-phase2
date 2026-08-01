# AEGIS Shield

AEGIS Shield is a zero-trust, resilient, and inclusive digital banking platform with SABCL metadata protection. This monorepo is the official Duothan 6.0 Phase 2 workspace for demonstrating secure banking journeys under normal operation, active threats, and service failure.

> **Current status:** Prompt 09 SABCL privacy and secure routing. The multilingual web UI, API Gateway, independent Identity, Payments and Ledger services, protected authorization, recovery, reconciliation, real browser validation, and the SABCL blind router with encrypted service envelopes are implemented.

## Core problem

Digital banking platforms must preserve financial correctness and service availability while supporting users across web, low-connectivity, and assisted channels. Perimeter security alone cannot adequately protect internal traffic, metadata can reveal sensitive activity, and tightly coupled services can amplify a single compromise or outage.

## Proposed solution

AEGIS Shield will separate banking capabilities into independently secured services with database-per-service ownership. Zero-trust customer and workload authentication, double-entry accounting, idempotent payments, threat detection, service quarantine, tamper-evident audit, and tested recovery will form complementary controls rather than one security boundary.

SABCL (Security-Aware Blind Communication Layer) is the project's signature metadata-protection concept, implemented in Prompt 09. Internal service calls are sealed with X25519, HKDF-SHA-256, AES-256-GCM and Ed25519 before they reach a blind router that forwards them without holding any key that opens them. Customer identifiers, account identifiers, amounts, recipient references, endpoint paths, operation names and PIN authorisation never appear in the routing envelope.

What it does not do is documented as carefully as what it does: padding hides exact payload size within a bucket and nothing more, and nothing protects a payload once the recipient has decrypted it. See the [protocol specification](docs/security/sabcl-protocol.md) and [metadata leakage analysis](docs/security/sabcl-metadata-leakage.md).

## Implemented scope

- pnpm workspace with one root lockfile
- Turborepo development and validation tasks
- Responsive Next.js customer application foundation at `apps/web`
- NestJS API gateway at `apps/api-gateway`
- `GET /health` API contract with a dynamic timestamp
- API port validation, local CORS, global input validation, and graceful shutdown hooks
- Deterministic web smoke tests and API unit/e2e tests
- GitHub Actions jobs for lint, typecheck, test, and build
- Reproducible Docker Compose services for PostgreSQL and authenticated Redis
- Four service-owned prototype databases with least-privilege roles
- Cross-platform infrastructure lifecycle, health, ownership, and validation commands
- Independent NestJS Identity service and Prisma migration
- Redis-backed hashed OTP challenges and opaque revocable sessions
- Tier-0 phone onboarding and Argon2id PIN plus OTP fallback
- WebAuthn/passkey backend boundaries
- Gateway allowlisting, HttpOnly session cookies, and CSRF protection
- Authentication unit, integration, and real-infrastructure e2e tests
- English, Sinhala, and Tamil customer authentication journeys
- Accessible multi-step onboarding with phone consent, OTP, and PIN creation
- Browser WebAuthn enrollment and passkey-first sign-in with PIN/OTP fallback
- Server-aware protected routes, session restoration, CSRF-safe logout, and unavailable-service states
- Chromium virtual-authenticator, responsive, and axe accessibility coverage
- Independent NestJS Ledger service and committed Prisma migration
- Tier-0 customer account provisioning with a zero opening balance
- Immutable double-entry journals and postings with append-only database triggers
- Integer minor-unit money handling with BigInt and decimal-string contracts
- Transactionally maintained balance projections and deferred database balance checks
- Idempotent account and journal operations with payload-hash conflict detection
- Deterministic account locking and concurrency-safe insufficient-funds enforcement
- Ledger reconciliation command and internal reconciliation routes
- Authenticated Gateway account routes with session-derived customer identity
- Multilingual minimal account summary in the web application
- Short-lived transfer intents, PIN step-up, CSRF, rate limits, and stable idempotent confirmation
- Independent Payments orchestration with append-only lifecycle events and bounded recovery
- Immutable `CUSTOMER_TRANSFER` journals with deterministic locks and exact BigInt balances
- Sent/received history, masked previews, printable receipts, EN/SI/TA, responsive and axe coverage
- Reserved boundaries for future services, shared packages, and infrastructure
- SABCL/1 encrypted service envelopes, an independent blind router on port 4103, opaque route tokens, capability path allowlists, Redis-backed replay protection, key rotation and revocation, and an operator status page

External payment rails, QR/offline payments, threat detection, service quarantine, production messaging, and disaster recovery are intentionally deferred.

## Monorepo structure

```text
.
|-- .github/
|   |-- ISSUE_TEMPLATE/       # Structured issue forms
|   `-- workflows/ci.yml      # Lint, typecheck, test, and build CI
|-- apps/
|   |-- api-gateway/          # NestJS HTTP gateway and health endpoint
|   `-- web/                  # Next.js customer experience shell
|-- docs/
|   |-- architecture/         # Current boundaries and future flows
|   |-- decisions/            # Architecture Decision Records
|   `-- demo/                 # Phase 2 demonstration plans
|-- infra/                    # Local data infrastructure, checks, and documentation
|-- docker-compose.yml        # Loopback-only PostgreSQL and Redis services
|-- packages/contracts/       # Versioned shared runtime auth and account schemas
|-- packages/sabcl/           # SABCL/1 protocol: envelopes, crypto, keys, routing
|-- services/identity/        # Private customer identity service
|-- services/ledger/          # Private accounts and double-entry ledger service
|-- services/payments/        # Private customer transfer orchestration service
|-- services/sabcl-router/    # Blind router: forwards envelopes it cannot read
|-- package.json              # Root scripts and tool versions
|-- pnpm-lock.yaml            # Single dependency lockfile
|-- pnpm-workspace.yaml       # Workspace and build-policy configuration
`-- turbo.json                # Task graph and output declarations
```

## Prerequisites

- Git
- Node.js `>=22.12` (the project currently uses Node.js 22 via `.nvmrc`)
- pnpm `11.8.0`, as pinned by `packageManager` in `package.json`
- Docker Desktop or Docker Engine with Docker Compose v2 (for infrastructure only)

Enable the package manager through Corepack if pnpm is not already available:

```powershell
corepack enable
corepack prepare pnpm@11.8.0 --activate
```

## Installation

```powershell
git clone https://github.com/NavozZ/aegis-shield-phase2.git
Set-Location aegis-shield-phase2
pnpm install
```

Copy the environment template before starting infrastructure and change every local-only password in the ignored file:

```powershell
Copy-Item .env.example .env
```

`.env` is ignored and must never be committed.

## Local infrastructure

Start Docker Desktop, then validate and run PostgreSQL and Redis:

```powershell
pnpm infra:validate
pnpm infra:up
pnpm infra:check
```

Start infrastructure followed by the existing web and API development processes:

```powershell
pnpm dev:full
```

Stop containers without deleting local data, or explicitly reset disposable local data:

```powershell
pnpm infra:down
pnpm infra:reset -- --yes
```

See [infra/README.md](infra/README.md) for ports, volumes, roles, initialization behavior, logs, and troubleshooting.

## Development

Start all development servers:

```powershell
pnpm dev
```

- Web application: `http://localhost:3000`
- API gateway: `http://localhost:4000`
- API health: `http://localhost:4000/health`
- Gateway readiness: `http://localhost:4000/health/ready`
- Identity service: `http://127.0.0.1:4101` (internal only)
- Ledger service: `http://127.0.0.1:4102` (internal only)
- Payments service: `http://127.0.0.1:4104` (internal only)

Start a single application:

```powershell
pnpm --filter @aegis/web dev
pnpm --filter @aegis/api-gateway dev
```

Start the built stack with readiness waiting and clean shutdown on `Ctrl+C`:

```powershell
pnpm build
pnpm stack:start
```

## Quality commands

```powershell
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run API-specific checks with:

```powershell
pnpm --filter @aegis/api-gateway test
pnpm --filter @aegis/api-gateway test:e2e
pnpm --filter @aegis/identity-service test
pnpm --filter @aegis/identity-service test:e2e
pnpm auth:test
pnpm auth:test:e2e
```

Run ledger checks with:

```powershell
pnpm ledger:test
pnpm ledger:test:integration
pnpm ledger:test:e2e
pnpm ledger:reconcile
```

Only `pnpm ledger:test` runs without Docker. The integration, end-to-end and reconciliation commands require PostgreSQL and run in GitHub Actions or on a Docker-capable machine.

Run transfer orchestration and real four-service checks with:

```powershell
pnpm payments:test
pnpm payments:test:integration
pnpm payments:test:e2e
pnpm payments:recover
pnpm payments:reconcile
```

Run web unit, browser, and accessibility checks with:

```powershell
pnpm web:test
pnpm web:e2e:install
pnpm web:test:e2e
pnpm web:test:a11y
```

Browser tests use synthetic identities, start controlled local dependencies, clean only their own records, and stop applications and containers afterward.

Generated framework and Turborepo output can be removed safely with `pnpm clean`.

## Architecture

The browser calls the Gateway for authentication, accounts, and transfers. Gateway sends PIN step-up only to Identity and trusted customer context only to Payments. Payments owns intent/idempotency/lifecycle state and asks Ledger—the sole balance authority—to post one balanced transfer journal. Identity, Payments, and Ledger own separate databases and never share tables. Raw sessions, PINs, internal tokens, hashes, and internal identifiers never enter public responses or browser storage.

Money is stored and transported as integer minor units, never as a JavaScript number. Journals are immutable and their balance is enforced by deferred database constraint triggers.

See [Architecture Documentation](docs/architecture/README.md), [Identity README](services/identity/README.md), [Ledger README](services/ledger/README.md), [ADR 0004](docs/decisions/0004-identity-and-session-authentication.md), [ADR 0005](docs/decisions/0005-authentication-user-experience.md), [ADR 0006](docs/decisions/0006-accounts-and-double-entry-ledger.md), the [authentication demo](docs/demo/authentication-demo.md), the [accounts and ledger demo](docs/demo/accounts-ledger-demo.md), the [authentication threat model](docs/security/authentication-threat-model.md), and the [ledger integrity model](docs/security/ledger-integrity-model.md).

## SABCL privacy and secure routing

Every integrated Gateway call to Identity, Ledger or Payments is sealed before it
leaves the Gateway process and opened only inside the service that owns the data.
The router between them resolves an opaque route token to an allowlisted
destination and forwards the bytes; it holds no key that opens them.

```bash
pnpm sabcl:keys -- --service gateway --version 1   # generate an identity
pnpm sabcl:keys -- --route-secret                  # generate the route secret
pnpm sabcl:test                                    # protocol, crypto, rotation
pnpm sabcl:test:leakage                            # metadata leakage scan
pnpm sabcl:test:router                             # routing, replay, rate limits
pnpm sabcl:test:integration                        # + real Redis   (infra:up)
pnpm sabcl:test:e2e                                # strict-mode journey (infra:up)
```

Set `SABCL_MODE=strict` to require the encrypted path with no fallback,
`compatible` for a documented local fallback (refused in production), or `off` to
keep the pre-Prompt-09 direct calls.

See the [SABCL router README](services/sabcl-router/README.md),
[protocol specification](docs/security/sabcl-protocol.md),
[ADR 0009](docs/decisions/0009-sabcl-privacy-and-secure-routing.md),
[threat model](docs/security/sabcl-threat-model.md),
[metadata leakage analysis](docs/security/sabcl-metadata-leakage.md),
[replay and expiry design](docs/security/sabcl-replay-and-expiry.md),
[key management and rotation](docs/security/sabcl-key-management.md),
[route-token provisioning](docs/security/sabcl-route-provisioning.md),
[operations runbook](docs/security/sabcl-runbook.md), and the
[SABCL routing demo](docs/demo/sabcl-routing-demo.md).

## Next milestones

- production workload identity and OTP delivery
- transaction history and statements
- idempotent transfers, payments, and inclusive access channels
- ~~SABCL metadata-protection path~~ — implemented in Prompt 09
- threat detection and service quarantine
- observability, audit integrity, and recovery

Each milestone will use a short-lived branch and a traceable pull request as described in [CONTRIBUTING.md](CONTRIBUTING.md).

## Security warning

This is a hackathon prototype, not a production banking system. Use synthetic identities and fake balances only. Never provide real money, personal financial data, banking credentials, production secrets, or cryptographic material. Report suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Operational instructions are maintained in the [Phase 2 User Guide](USER_GUIDE.md).
