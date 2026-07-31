# ADR 0001: Repository and branch strategy

- **Status:** Accepted
- **Date:** 2026-07-31
- **Decision owners:** AEGIS Shield maintainers

## Context

Phase 2 must deliver several independently deployable banking and security capabilities while keeping cross-cutting contracts, demonstration assets, documentation, and governance consistent. Contributors need a workflow that makes small changes reviewable and prevents incomplete or unreviewed work from accumulating on long-lived integration branches.

The repository will also contain security-sensitive configuration contracts and educational banking scenarios. Accidental secret exposure would remain harmful even in a prototype and cannot be made safe merely by deleting a later revision.

## Decision

AEGIS Shield Phase 2 will use a monorepo. Service implementations remain independently owned and deployable, but their applications, shared contracts, infrastructure, tests, documentation, and demonstration assets are versioned together. This enables atomic review of cross-service contract changes and a reproducible platform demonstration without weakening database-per-service boundaries.

`main` is the only long-lived branch. All work uses short-lived branches created from the latest `origin/main`. This minimizes merge drift, keeps the history easy to reason about, and avoids environment branches becoming alternate sources of truth.

Every change enters `main` through a pull request. Reviews and required validation must complete before maintainers use a squash merge. Squashing gives each scoped change one clear mainline revision while development commits can still support review iteration.

One implementation prompt maps to one branch and one pull request. The mapping creates a direct audit trail from requested scope to code, validation, review, and rollback. Unrelated improvements must use a separate prompt or issue and branch.

Secrets are never committed. Tracked configuration examples contain explicitly fake values; real local configuration stays in ignored files and deployment secrets use an approved secret store. Any exposed credential must be revoked or rotated because removing it from a later commit does not remove prior exposure.

## Consequences

- Cross-service changes can be reviewed and tested atomically, but repository tooling must avoid unnecessary coupling.
- Service ownership and database boundaries must be enforced through structure, interfaces, tests, and review rather than separate repositories.
- Short-lived branches and prompt-sized pull requests reduce integration risk but require disciplined scoping.
- Squash merges optimize the mainline history at the cost of preserving every development commit on `main`.
- Contributors must keep their branches current and may not push directly to `main`.
- Secret scanning and review remain necessary even though ignore rules and example-value conventions reduce risk.
