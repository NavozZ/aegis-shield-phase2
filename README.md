# AEGIS Shield

AEGIS Shield is a zero-trust, resilient, and inclusive digital banking platform with SABCL metadata protection. This repository is the official Duothan 6.0 Phase 2 workspace for demonstrating secure banking journeys under normal operation, active threats, and service failure.

> **Project status:** Repository foundation only. Application frameworks and working services will be introduced in later implementation prompts.

## Core problem

Digital banking platforms must keep financial records correct and services available while serving users across modern web, low-connectivity, and assisted channels. Traditional perimeter security does not adequately protect internal service traffic, metadata can still reveal sensitive activity, and tightly coupled services can amplify a single compromise or outage.

## Proposed solution

AEGIS Shield separates banking capabilities into independently secured microservices with database-per-service ownership. Zero-trust customer and workload authentication, double-entry accounting, idempotent payments, threat detection, service quarantine, tamper-evident audit, and tested recovery controls are planned as complementary layers rather than a single security boundary.

## Signature SABCL innovation

SABCL (Security-Aware Blind Communication Layer) is the project's signature metadata-protection concept. It is intended to reduce information leakage from service-to-service communication patterns while retaining authenticated, observable, and policy-controlled operations. Phase 2 will include a controlled comparison between ordinary internal traffic and SABCL-protected traffic.

## Phase 2 demonstration scope

- Secure customer login with zero-trust controls
- Protected, idempotent funds transfer backed by double-entry ledger entries
- QR and offline-assisted payment journeys
- USSD and agent-assisted access
- Threat detection and risk-driven response
- Compromised-service quarantine
- Failure recovery and tamper-evident audit verification
- SABCL traffic and metadata comparison
- Customer application and security operations console

## Planned architecture

The planned monorepo will contain independently deployable identity, accounts, ledger, payments, threat-detection, SABCL, audit, notification, and recovery capabilities. Each stateful service owns its database boundary. An API gateway mediates channel access, while workload identity and explicit authorization protect service calls. Architecture diagrams and flows will be maintained in [docs/architecture/README.md](docs/architecture/README.md).

## Planned technology stack

The final choices will be recorded through architecture decisions. The current direction is:

- TypeScript with Next.js for customer and operations interfaces
- TypeScript with NestJS for API and banking services
- Python for threat-detection workloads
- Go for selected high-throughput SABCL or infrastructure components
- PostgreSQL with database-per-service boundaries
- Redis for bounded caching, coordination, and idempotency support
- Containers for reproducible local demonstrations
- OpenTelemetry-compatible logs, metrics, and traces

No application framework has been scaffolded in this repository yet.

## Repository structure

```text
.
|-- .github/              # Contribution automation and ownership
|-- docs/
|   |-- architecture/     # System diagrams and security/data flows
|   |-- decisions/        # Architecture Decision Records (ADRs)
|   `-- demo/             # Phase 2 demonstration plans
|-- .env.example          # Safe configuration contract
|-- CONTRIBUTING.md       # Engineering workflow
|-- SECURITY.md           # Prototype security policy
`-- USER_GUIDE.md         # Operator and demonstration guide
```

Application directories will be documented when they are introduced.

## Branch and commit conventions

The repository uses GitHub Flow with `main` as its only long-lived branch. Work is developed on short-lived branches named `<type>/<prompt>-<description>`, for example `chore/p00-repository-foundation`. Each prompt maps to one branch and pull request. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), and accepted pull requests are squash-merged. See [CONTRIBUTING.md](CONTRIBUTING.md) for the complete policy.

## Local setup

To be completed during implementation. A future prompt will provide reproducible prerequisites, environment preparation, and startup commands. Never populate committed files with real credentials; use `.env.example` only as a configuration reference.

## Testing

To be completed during implementation. Service-level unit, integration, contract, security, resilience, and end-to-end demonstration checks will be documented alongside executable commands.

## Security warning

This is an educational prototype, not a production banking system. Do not use it with real money, personal financial data, banking credentials, production cryptographic material, or public-facing production infrastructure. Report suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Phase 2 deliverables

- [x] Public repository and governance foundation
- [x] Required user-guide structure
- [x] Architecture, demonstration, and decision-documentation areas
- [ ] Independent banking microservices
- [ ] Database-per-service implementation
- [ ] Customer application and security operations console
- [ ] Web, QR, USSD, and agent-assisted journeys
- [ ] Zero-trust customer and workload authentication
- [ ] Double-entry ledger and idempotent payments
- [ ] SABCL metadata-protection demonstration
- [ ] Threat detection, quarantine, audit, and recovery demonstration
- [ ] Automated test and validation suite
- [ ] Completed [Phase 2 User Guide](USER_GUIDE.md)
