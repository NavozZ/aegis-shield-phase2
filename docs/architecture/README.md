# Architecture Documentation

This document describes the currently implemented Prompt 01 boundaries and reserves the flows that later milestones must define. Architecture changes must preserve explicit trust boundaries, data ownership, and bounded failure behavior.

## Current monorepo boundaries

```text
apps/       Independently runnable user-facing and gateway applications
services/   Reserved independently deployable banking and security services
packages/   Reserved shared contracts, configuration, security, UI, and test utilities
infra/      Reserved local orchestration, observability, deployment, and recovery assets
docs/       Architecture, decisions, and demonstration procedures
```

pnpm provides one workspace and root lockfile. Turborepo coordinates tasks without changing application ownership.

## Web application responsibility

`apps/web` is the Next.js customer experience boundary. It currently renders only the responsive AEGIS Shield foundation page. It owns presentation, accessibility, and later customer-channel composition; it must not own ledger state, authentication policy, or authoritative banking records.

## API gateway responsibility

`apps/api-gateway` is the NestJS HTTP entry point. It currently exposes only `GET /health`, validates its listening port, accepts the local web origin through CORS, applies a secure global validation pipe, and enables graceful shutdown hooks.

Later milestones may add authentication enforcement and request routing. The gateway must not become the owner of banking data or domain logic.

## Future independent service boundaries

- identity
- accounts-ledger
- payments
- threat-detection
- sabcl-proxy
- notifications
- recovery

Each stateful service will own its data store and publish explicit contracts. Shared packages may contain schemas and utilities, but never direct cross-service database access.

## Current request-flow placeholder

```text
browser → web → API gateway → future services
```

Only the browser-to-web foundation page and direct API health request are implemented. Application-to-gateway business requests and all gateway-to-service calls are placeholders.

## Deferred infrastructure

Databases, Redis, queues, service messaging, containers, deployment manifests, workload identity, and observability backends are intentionally deferred. No implementation should infer that a placeholder flow has persistence or delivery guarantees.

## Future diagrams and flows

The following remain to be completed as their implementations are introduced:

- context and container diagrams
- service responsibilities and data ownership
- customer and workload authentication flow
- idempotent transfer and double-entry posting flow
- SABCL-protected communication flow
- failure isolation, reconciliation, and recovery flow
