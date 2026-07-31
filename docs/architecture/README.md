# Architecture Documentation

This document describes the currently implemented Prompt 04 authentication boundaries and reserves the flows that later milestones must define. Architecture changes must preserve explicit trust boundaries, data ownership, and bounded failure behavior.

## Current monorepo boundaries

```text
apps/       Independently runnable user-facing and gateway applications
services/   Independently deployable services; Identity is implemented
packages/   Shared versioned contracts; authentication v1 is implemented
infra/      Local data orchestration and checks; future deployment and recovery assets
docs/       Architecture, decisions, and demonstration procedures
```

pnpm provides one workspace and root lockfile. Turborepo coordinates tasks without changing application ownership.

## Web application responsibility

`apps/web` is the Next.js customer experience boundary. It owns multilingual presentation, accessible multi-step flow state, browser WebAuthn ceremonies, safe API integration, and server-aware protected-route checks. Sensitive onboarding and fallback values remain in React memory and are cleared on reload or completion. The web app does not own authentication policy, ledger state, or authoritative banking records.

## API gateway responsibility

`apps/api-gateway` is the public NestJS HTTP entry point. It preserves `GET /health`, adds dependency readiness and allowlisted `/api/v1/auth/*` routes, validates shared contracts, applies bounded request handling, and owns browser cookie and double-submit CSRF enforcement.

The Gateway does not own credentials, user records, sessions, or banking state and is not a generic proxy.

## Identity responsibility

`services/identity` is loopback-bound with no browser CORS. An internal token protects every route except liveness. Identity owns Tier-0 onboarding, hashed OTP challenges, Argon2id PIN verification, passkey public credentials/counters, revocable opaque sessions, and safe authentication events. PostgreSQL holds durable identity records; Redis holds expiring challenge and session state.

## Future independent service boundaries

- accounts-ledger
- payments
- threat-detection
- sabcl-proxy
- notifications
- recovery

Each stateful service will own its data store and publish explicit contracts. Shared packages may contain schemas and utilities, but never direct cross-service database access. Prompt 02 models that ownership with separate identity, ledger, payments, and audit databases and login roles inside one local PostgreSQL container.

## Current and future data flow

```text
Browser → Next.js UI assets and protected server rendering
Browser → NestJS API Gateway authentication routes (credentialed CORS)
Next.js server → NestJS API Gateway session route (session cookie only)
NestJS API Gateway → allowlisted Identity API (internal token)
Identity → Identity-owned PostgreSQL app schema
Identity → Identity Redis namespace
```

The browser never calls Identity directly. The Gateway sets the HttpOnly session and readable double-submit CSRF cookies, validates the exact configured web origin, and normalizes public errors. Next.js receives only safe session fields when rendering protected pages. Banking business requests and all other service connections remain deferred.

## Local data and messaging boundaries

PostgreSQL provides four logically isolated prototype databases. Identity now uses its service database, while Redis stores bounded authentication state for:

- sessions
- OTP and passkey challenges
- resend, request, and login limits

Queues, general caching/idempotency, production service messaging, deployment manifests, workload identity, and observability backends remain deferred. Identity is the only application with a data connection in this milestone.

## Future diagrams and flows

The following remain to be completed as their implementations are introduced:

- context and container diagrams
- service responsibilities and data ownership
- production workload-authentication flow
- idempotent transfer and double-entry posting flow
- SABCL-protected communication flow
- failure isolation, reconciliation, and recovery flow
