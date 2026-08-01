# AEGIS Shield

AEGIS Shield is a zero-trust, resilient, and inclusive digital banking platform with SABCL metadata protection. This monorepo is the official Duothan 6.0 Phase 2 workspace for demonstrating secure banking journeys under normal operation, active threats, and service failure.

> **Current status:** Prompt 10 deterministic threat detection and automated controls. The multilingual customer UI, security-operator console, API Gateway, independent Identity, Payments, Ledger and Risk services, enforceable controls, incident audit, recovery, reconciliation, and real browser validation are implemented.

## Core problem

Digital banking platforms must preserve financial correctness and service availability while supporting users across web, low-connectivity, and assisted channels. Perimeter security alone cannot adequately protect internal traffic, metadata can reveal sensitive activity, and tightly coupled services can amplify a single compromise or outage.

## Proposed solution

AEGIS Shield will separate banking capabilities into independently secured services with database-per-service ownership. Zero-trust customer and workload authentication, double-entry accounting, idempotent payments, threat detection, service quarantine, tamper-evident audit, and tested recovery will form complementary controls rather than one security boundary.

SABCL (Security-Aware Blind Communication Layer) is the project's signature metadata-protection concept. A later milestone will compare ordinary internal traffic with SABCL-protected communication in a controlled demonstration.

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
- Versioned, authenticated and idempotent security-event ingestion with bounded retention
- Explainable deterministic risk scoring, versioned reasons and Redis velocity windows
- Expiring scoped controls enforced independently by Gateway, Payments and Identity
- Role-protected security-operator console with incident and control lifecycle audit
- Risk recovery/reconciliation plus real escalation, triage, release and recovery browser coverage
- Reserved boundaries for future services, shared packages, and infrastructure

External payment rails, QR/offline payments, SABCL, a trained fraud model, production workforce identity, production messaging, and disaster recovery are intentionally deferred.

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
|-- services/identity/        # Private customer identity service
|-- services/ledger/          # Private accounts and double-entry ledger service
|-- services/payments/        # Private customer transfer orchestration
|-- services/risk/            # Threat detection, incidents and scoped controls
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
- Risk service: `http://127.0.0.1:4105` (internal only)

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

The browser calls the Gateway for authentication, accounts, transfers and security operations. Gateway sends PIN step-up only to Identity, checks Risk before sensitive confirmation and sends trusted customer context only to Payments. Payments independently evaluates its authoritative intent with Risk before asking Ledger—the sole balance authority—to post one balanced transfer journal. Identity, Payments, Ledger and Risk own isolated databases and never share tables. Raw sessions, PINs, internal tokens and full account references never enter public responses or browser storage.

Money is stored and transported as integer minor units, never as a JavaScript number. Journals are immutable and their balance is enforced by deferred database constraint triggers.

See [Architecture Documentation](docs/architecture/README.md), [Risk architecture](docs/architecture/threat-detection-and-controls.md), [Risk README](services/risk/README.md), [ADR 0010](docs/decisions/0010-threat-detection-and-automated-controls.md), the [risk demo](docs/demo/risk-controls-demo.md), and the [threat-detection threat model](docs/security/threat-detection-threat-model.md).

## Next milestones

- production workload identity and OTP delivery
- transaction history and statements
- idempotent transfers, payments, and inclusive access channels
- SABCL metadata-protection path
- governed fraud-model evaluation and production workforce identity
- observability, audit integrity, and recovery

Each milestone will use a short-lived branch and a traceable pull request as described in [CONTRIBUTING.md](CONTRIBUTING.md).

## Security warning

This is a hackathon prototype, not a production banking system. Use synthetic identities and fake balances only. Never provide real money, personal financial data, banking credentials, production secrets, or cryptographic material. Report suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Operational instructions are maintained in the [Phase 2 User Guide](USER_GUIDE.md).
