# ADR 0002: Monorepo tooling and application foundations

- **Status:** Accepted
- **Date:** 2026-07-31
- **Decision owner:** NavozZ

## Context

AEGIS Shield Phase 2 needs multiple independently deployable applications and future services while retaining one reproducible demonstration, one dependency review surface, and atomic cross-boundary contract changes. Prompt 01 must establish the development platform without introducing banking logic or infrastructure that belongs to later milestones.

## Decision

Use pnpm workspaces to manage `apps/*`, `services/*`, and `packages/*` with one lockfile at the repository root. pnpm provides deterministic installation, explicit workspace boundaries, and efficient dependency storage.

Use Turborepo to orchestrate development, build, lint, typecheck, test, and clean tasks. Task configuration records dependency ordering and generated outputs without coupling application source code.

Use Next.js with the App Router for the customer web application. It provides an accessible, server-rendered React foundation and a clear path for later customer journeys.

Use NestJS for the HTTP API gateway. Its module boundaries, dependency injection, validation pipeline, and test support provide a structured entry point for future services without implementing service transports prematurely.

Keep the web application and API gateway as separate workspace applications. Reserve `services/` for independently deployable banking and security capabilities and `packages/` for deliberately shared contracts and tooling.

## Alternatives considered

- **npm workspaces:** viable, but pnpm offers stricter dependency resolution and more efficient storage for the planned workspace scale.
- **Yarn workspaces:** capable, but would add another package-manager model without a project-specific advantage.
- **Nx:** comprehensive, but its broader project model and generators are unnecessary for this initial foundation.
- **A single full-stack application:** simpler initially, but it would blur the API boundary and make later service separation harder.
- **Separate repositories:** stronger physical separation, but would complicate atomic contracts and the reproducible Phase 2 demonstration.

## Consequences

- Contributors use pnpm only and commit one root `pnpm-lock.yaml`.
- Root commands provide consistent local and CI validation across applications.
- Application packages remain independently buildable even though tooling is shared.
- Turborepo metadata and framework build output are generated and ignored.
- Future services can adopt an appropriate runtime while respecting repository contracts and data ownership.
- Framework upgrades and lockfile changes require workspace-wide validation.
