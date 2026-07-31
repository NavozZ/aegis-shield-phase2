# AEGIS Shield

AEGIS Shield is a zero-trust, resilient, and inclusive digital banking platform with SABCL metadata protection. This monorepo is the official Duothan 6.0 Phase 2 workspace for demonstrating secure banking journeys under normal operation, active threats, and service failure.

> **Current status:** Prompt 04 customer authentication experience. The multilingual web UI, API Gateway, independent Identity service, PostgreSQL/Redis authentication state, shared contracts, protected application shell, and browser validation are implemented.

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
- Reserved boundaries for future services, shared packages, and infrastructure

Accounts, ledgers, payments, SABCL, threat detection, service quarantine, production messaging, and disaster recovery are intentionally deferred.

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
|-- packages/contracts/       # Versioned shared runtime auth schemas
|-- services/identity/        # Private customer identity service
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

Start a single application:

```powershell
pnpm --filter @aegis/web dev
pnpm --filter @aegis/api-gateway dev
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

The browser loads the Next.js interface and calls the NestJS API Gateway directly for authentication. Next.js server components also ask the Gateway for safe session state before rendering protected routes. The Gateway owns the public HTTP/cookie boundary and forwards only allowlisted authentication operations to the private Identity service. Identity owns the `aegis_identity` PostgreSQL schema and its namespaced Redis authentication state. Raw opaque sessions never enter response bodies or browser storage.

See [Architecture Documentation](docs/architecture/README.md), [Identity README](services/identity/README.md), [ADR 0004](docs/decisions/0004-identity-and-session-authentication.md), [ADR 0005](docs/decisions/0005-authentication-user-experience.md), the [authentication demo](docs/demo/authentication-demo.md), and the [authentication threat model](docs/security/authentication-threat-model.md).

## Next milestones

- production workload identity and OTP delivery
- accounts and double-entry ledger
- idempotent payments and inclusive access channels
- SABCL metadata-protection path
- threat detection and service quarantine
- observability, audit integrity, and recovery

Each milestone will use a short-lived branch and a traceable pull request as described in [CONTRIBUTING.md](CONTRIBUTING.md).

## Security warning

This is a hackathon prototype, not a production banking system. Use synthetic identities and fake balances only. Never provide real money, personal financial data, banking credentials, production secrets, or cryptographic material. Report suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Operational instructions are maintained in the [Phase 2 User Guide](USER_GUIDE.md).
