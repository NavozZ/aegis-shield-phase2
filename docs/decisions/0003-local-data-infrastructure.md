# ADR 0003: Local data and messaging infrastructure

- **Status:** Accepted
- **Date:** 2026-07-31
- **Decision owner:** NavozZ

## Context

AEGIS Shield needs reproducible local persistence before independently owned services are implemented. Development must model database ownership and authenticated cache access without introducing cloud dependencies, application data models, or an administration surface. The environment must work consistently on Windows, Linux, Git Bash, and GitHub Actions.

## Decision

Use the official `postgres:17.10-alpine` image for relational persistence. PostgreSQL supplies transactions, constraints, mature operational tooling, and a suitable future foundation for identity, ledger, payments, and audit data.

One local PostgreSQL container hosts four prototype databases with separate least-privilege login roles. This preserves logical database-per-service ownership while keeping local resource use and startup complexity low. Production environments will apply stronger isolation through separately managed instances or clusters where risk, scale, and recovery boundaries require it.

Use the official `redis:8.6.5-alpine` image with authentication and append-only persistence. Redis is reserved for future sessions, idempotency records, caching, and lightweight event streams. Applications do not connect to it in this decision.

Bind published database and Redis ports only to `127.0.0.1` so development services are not exposed to the local network. Store both data sets in named Docker volumes for repeatable container replacement and persistence across ordinary shutdowns.

Do not include pgAdmin, RedisInsight, or another database administration UI. Command-line checks cover the required health and ownership evidence without adding an exposed privileged surface or another dependency to maintain.

## Alternatives considered

- **Separate PostgreSQL containers per service:** closer to production isolation, but unnecessarily expensive and operationally noisy before the services exist.
- **SQLite:** simple, but it would not exercise role ownership, connection isolation, or the concurrency behavior expected from the future platform.
- **An unauthenticated ephemeral Redis container:** easier to configure, but unsafe even for a loopback-published development service and unable to verify persistence behavior.
- **Host-directory data mounts:** directly inspectable, but less portable across Docker Desktop, Linux permissions, and CI than named volumes.
- **Database administration UIs:** convenient, but add images, ports, credentials, and attack surface that Prompt 02 does not need.

## Consequences

- Developers need a running Docker engine for infrastructure commands, while `pnpm dev` remains Docker-independent.
- Ordinary shutdown preserves data; reset requires explicit confirmation and reruns initialization.
- Changing initialization variables does not alter an existing PostgreSQL volume.
- One container failure affects all four local prototype databases, even though ownership is logically isolated.
- Exact image patch tags improve reproducibility but require deliberate maintenance updates.

## Security considerations

- Ports are published on loopback only, Redis always requires a password, and service roles receive no administrative privileges.
- Passwords come from environment variables; tracked values are marked development-only and must be changed in ignored `.env` files.
- Local Docker administrators can inspect container configuration, and local connections are not protected with TLS.
- The shared host, container, network, and PostgreSQL instance are not production-grade isolation boundaries.
- No real customers, banking data, production secrets, or cryptographic material may be used.
