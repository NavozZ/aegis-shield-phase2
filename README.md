# AEGIS Shield

AEGIS Shield is a zero-trust, resilient, and inclusive digital banking platform with SABCL metadata protection. This monorepo is the official Duothan 6.0 Phase 2 workspace for demonstrating secure banking journeys under normal operation, active threats, and service failure.

> **Current status:** Prompt 11 operational resilience and disaster recovery, on top of Prompt 08 inclusive channels, Prompt 09 SABCL routing and Prompt 10 threat detection. The multilingual customer UI, security-operator console, recovery operations console, API Gateway, independent Identity, Payments, Ledger, SABCL router, Risk and Resilience services, QR/USSD/agent-cash channels, encrypted metadata-minimising service routing, enforceable controls, incident audit, encrypted backup sets with isolated restore verification, deterministic recovery drills, reconciliation, and real browser validation are implemented.

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
- Five service-owned prototype databases with least-privilege roles
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
- QR Pay with signed payloads and expiry, USSD session state, and agent cash with per-agent limits and idempotency — see the release blockers below before demonstrating the USSD or agent channels
- Versioned, authenticated and idempotent security-event ingestion with bounded retention
- Explainable deterministic risk scoring, versioned reasons and Redis velocity windows
- Expiring scoped controls enforced independently by Gateway, Payments and Identity
- Role-protected security-operator console with incident and control lifecycle audit
- Risk recovery/reconciliation plus real escalation, triage, release and recovery browser coverage
- Reserved boundaries for future services, shared packages, and infrastructure
- SABCL/1 encrypted service envelopes, an independent blind router on port 4103, opaque route tokens, capability path allowlists, Redis-backed replay protection, key rotation and revocation, and an operator status page
- AES-256-GCM encrypted backup sets for the five authoritative databases, checksum-before-decrypt verification, and refusal of tampered, incomplete, wrong-key and path-unsafe sets
- Isolated restore verification into disposable databases that can never target a live service database
- Deterministic recovery drills with an append-only, transition-validated evidence trail and a recovery operations console

External payment rails, a trained fraud model, production workforce identity, and production messaging are intentionally deferred. QR/offline payments arrived in Prompt 08, SABCL in Prompt 09, threat detection with service quarantine in Prompt 10, and prototype operational resilience with encrypted backup and recovery drills in Prompt 11. Production multi-region disaster recovery, continuous replication, zero data loss and compliance certification are explicitly **not** provided.

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
|-- services/risk/            # Threat detection, incidents and scoped controls
|-- services/resilience/      # Recovery drill evidence and backup-set registry
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
- SABCL router: `http://127.0.0.1:4103` (internal only, started when SABCL is configured)
- Payments service: `http://127.0.0.1:4104` (internal only)
- Risk service: `http://127.0.0.1:4105` (internal only)
- Resilience service: `http://127.0.0.1:4106` (internal only)

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

## One-command demonstration

```powershell
pnpm env:init:local          # create .env with generated local secrets
pnpm env:check               # validate it; names variables, never prints a value
pnpm demo:start              # infrastructure, migrations and every service
pnpm demo:status             # what is listening
pnpm demo:verify             # liveness, readiness and response-shape checks
pnpm demo:stop               # stop containers, keep local data
pnpm demo:reset -- --yes     # destroy local volumes, on explicit confirmation
pnpm demo:evidence           # synthetic screenshots into the ignored .evidence/
```

`demo:start` validates the environment, confirms the Docker engine, starts
PostgreSQL and Redis, applies every committed migration, then brings up Identity,
Ledger, the SABCL router (when configured), Payments, Risk, Resilience, the
Gateway and the web application, waiting on each readiness endpoint rather than
sleeping. Ctrl+C stops every child in reverse order and never deletes data.

Full walkthrough: [docs/release/FINAL_DEMO_GUIDE.md](docs/release/FINAL_DEMO_GUIDE.md).

## Reconciliation

```powershell
pnpm reconcile:all           # Ledger, Payments, Risk and Resilience together
pnpm ledger:reconcile
pnpm payments:reconcile
pnpm risk:reconcile
pnpm resilience:reconcile
```

`reconcile:all` preserves each individual result, reports a sanitized summary and
returns non-zero when any of the four fails. Risk and Resilience reconcile
through their running services rather than reaching into their schemas.

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
pnpm transactions:test:integration
pnpm transactions:test:e2e
```

Run payments and inclusive-channel checks with:

```powershell
pnpm payments:test
pnpm payments:test:startup
pnpm payments:test:integration
pnpm payments:test:e2e
pnpm channels:test
pnpm channels:test:qr
pnpm channels:test:ussd
pnpm channels:test:agent
```

Run risk and resilience checks with:

```powershell
pnpm risk:test
pnpm risk:test:integration
pnpm resilience:test
pnpm resilience:test:integration
```

Only `pnpm ledger:test` runs without Docker. The integration, end-to-end and reconciliation commands require PostgreSQL and run in GitHub Actions or on a Docker-capable machine.

Run transfer orchestration and real five-service checks with:

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

The browser calls the Gateway for authentication, accounts, transfers and security operations. Gateway sends PIN step-up only to Identity, checks Risk before sensitive confirmation and sends trusted customer context only to Payments. Payments independently evaluates its authoritative intent with Risk before asking Ledger—the sole balance authority—to post one balanced transfer journal. Identity, Payments, Ledger, Risk and Resilience own isolated databases and never share tables. Raw sessions, PINs, internal tokens and full account references never enter public responses or browser storage.

Money is stored and transported as integer minor units, never as a JavaScript number. Journals are immutable and their balance is enforced by deferred database constraint triggers.

See [Architecture Documentation](docs/architecture/README.md), [Risk architecture](docs/architecture/threat-detection-and-controls.md), [Risk README](services/risk/README.md), [ADR 0010](docs/decisions/0010-threat-detection-and-automated-controls.md), the [risk demo](docs/demo/risk-controls-demo.md), and the [threat-detection threat model](docs/security/threat-detection-threat-model.md).

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

## Operational resilience and disaster recovery

Backup and restore are operator command-line tooling. No HTTP route runs a
backup, runs a restore, accepts a filesystem path, accepts a database connection
string or executes a shell command — a console button that shells out would be
remote command execution behind a login.

```bash
pnpm dr:backup                  # encrypted set of the five authoritative databases
pnpm dr:backup:verify           # checksums and authenticity, no restore
pnpm dr:backup:verify:negative  # prove the tamper/wrong-key/incomplete refusals
pnpm dr:restore:verify          # isolated restore into disposable databases
pnpm dr:drill                   # the full deterministic drill
pnpm resilience:reconcile       # evidence consistency
```

Generate a local backup key and put it in `.env` as `DR_BACKUP_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Never commit a key. Redis is deliberately not backed up: it holds recreatable
cache, replay and velocity state, so after a restore customers sign in again.

Security operators read recovery readiness and drill history at
`/security-ops/resilience`. The figures shown are a **measured prototype
recovery-point age** and a **measured prototype recovery duration** from a drill
against local disposable infrastructure — not an RPO or RTO, and not a guarantee.

See [operational resilience architecture](docs/architecture/operational-resilience-and-dr.md),
[ADR 0011](docs/decisions/0011-operational-resilience-and-dr.md),
[backup encryption and key management](docs/security/backup-encryption-and-key-management.md),
[disaster-recovery threat model](docs/security/disaster-recovery-threat-model.md),
[recovery operator authorization](docs/security/recovery-operator-authorization.md),
[backup retention and disposal](docs/security/backup-retention-and-disposal.md),
[disaster-recovery runbook](docs/operations/disaster-recovery-runbook.md),
[service failure runbook](docs/operations/service-failure-runbook.md),
[backup and restore runbook](docs/operations/backup-restore-runbook.md), and the
[disaster recovery demo](docs/demo/disaster-recovery-demo.md).

## Next milestones

- production workload identity and OTP delivery
- ~~transaction history and statements~~ — implemented in Prompt 07
- ~~idempotent transfers, payments, and inclusive access channels~~ — implemented in Prompt 08
- ~~SABCL metadata-protection path~~ — implemented in Prompt 09
- ~~threat detection and service quarantine~~ — implemented in Prompt 10
- ~~prototype backup, restore verification and recovery drills~~ — implemented in Prompt 11
- governed fraud-model evaluation and production workforce identity
- observability, audit integrity, backup key custody and offsite immutable storage

Each milestone will use a short-lived branch and a traceable pull request as described in [CONTRIBUTING.md](CONTRIBUTING.md).

## Release blockers

The final security review records six confirmed defects in the inclusive-channel
code, including a route that moves money with no authentication. They are
documented rather than fixed in this release. **Do not demonstrate the USSD or
agent-cash channels as working, and do not expose the stack to a network.**

Full detail, with file-level evidence:
[docs/release/final-security-review.md](docs/release/final-security-review.md#release-blockers).

## Security warning

This is a hackathon prototype, not a production banking system. Use synthetic identities and fake balances only. Never provide real money, personal financial data, banking credentials, production secrets, or cryptographic material. Report suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Operational instructions are maintained in the [Phase 2 User Guide](USER_GUIDE.md).
