# AEGIS Shield Phase 2 User Guide

This guide explains how to run the Prompt 02 foundation and local infrastructure. The current platform exposes a customer-facing foundation page, an API health endpoint, PostgreSQL, and Redis; applications do not connect to the data services and the platform does not perform banking operations.

## Introduction

AEGIS Shield is a Duothan 6.0 hackathon prototype for resilient and inclusive zero-trust banking. All demonstrations must use synthetic data and fake identities.

## System requirements

- Git
- Node.js `>=20.9`; Node.js 22 is selected by `.nvmrc`
- pnpm `11.8.0`
- Docker Desktop or Docker Engine with Docker Compose v2
- Available local TCP ports 3000, 4000, 5432, and 6379

Confirm the toolchain:

```powershell
node --version
pnpm --version
docker --version
docker compose version
docker info
```

## Installation

Clone and install from the repository root:

```powershell
git clone https://github.com/NavozZ/aegis-shield-phase2.git
Set-Location aegis-shield-phase2
pnpm install
```

Do not run `npm install` or Yarn in this repository. The monorepo uses one root `pnpm-lock.yaml`.

## Environment and infrastructure setup

1. Copy the documented template to an ignored local file:

```powershell
Copy-Item .env.example .env
```

2. Change every value ending in `_PASSWORD` in `.env`. Update the matching `*_DATABASE_URL` and `REDIS_URL` values when changing credentials or ports. These are local-only development credentials; never reuse a real password.

3. Start Docker Desktop and wait until its Linux container engine reports that it is running. The resulting `.env` remains ignored and must never be committed.

4. Validate and start infrastructure:

```powershell
pnpm infra:validate
pnpm infra:up
```

5. Check PostgreSQL readiness, authenticated Redis access, databases, roles, ownership, and container health:

```powershell
pnpm infra:status
pnpm infra:check
```

6. Start the full environment:

```powershell
pnpm dev:full
```

This leaves Docker infrastructure running when `Ctrl+C` stops the web and API processes. Normal `pnpm dev` remains available when Docker is not needed.

7. View all infrastructure logs or one service:

```powershell
pnpm infra:logs
pnpm infra:logs -- postgres
pnpm infra:logs -- redis
```

8. Stop containers while preserving local data:

```powershell
pnpm infra:down
```

9. When existing local data is disposable and initialization must run again, use the explicitly confirmed destructive reset:

```powershell
pnpm infra:reset -- --yes
```

PostgreSQL initialization scripts run only when the named volume is first created. Changing `.env` database credentials does not alter an existing volume.

## Starting the platform

Start the web application and API gateway together without requiring Docker:

```powershell
pnpm dev
```

Open `http://localhost:3000`. Turborepo prefixes each process log with its workspace package name.

## Starting only the web application

```powershell
pnpm --filter @aegis/web dev
```

Open `http://localhost:3000`.

## Starting only the API gateway

```powershell
pnpm --filter @aegis/api-gateway dev
```

The gateway listens on `http://localhost:4000` by default.

## Checking API health

With the API gateway running:

```powershell
Invoke-RestMethod http://localhost:4000/health
```

The response contains `status: ok`, service name, version, a dynamic ISO-8601 timestamp, and the current environment. It contains no database or secret information.

## Demo user credentials

No users or credentials exist in Prompt 01. Authentication will be implemented in a later milestone using synthetic demonstration identities only.

## Customer journeys

The web foundation page is the only customer view. Login, dashboard, transfers, QR payments, USSD, and agent-assisted journeys are intentionally deferred.

## Administrator journey

To be completed during implementation. No security operations console exists yet.

## Security demonstration

To be completed during implementation. Threat detection and quarantine are not part of Prompt 01.

## SABCL demonstration

To be completed during implementation. SABCL communication is not part of Prompt 01.

## Recovery demonstration

To be completed during implementation. Databases, audit storage, and recovery flows are not part of Prompt 01.

## Troubleshooting

### pnpm is unavailable

Use the official Corepack route:

```powershell
corepack enable
corepack prepare pnpm@11.8.0 --activate
```

### A port is already in use

Identify the process using port 3000, 4000, 5432, or 6379; do not terminate an unknown process. For a temporary API-only override:

```powershell
$env:API_PORT = '4100'
pnpm --filter @aegis/api-gateway dev
```

Values outside 1–65535 cause the API to fail safely with a configuration error.

PostgreSQL and Redis host ports can be changed through `POSTGRES_PORT` and `REDIS_PORT` in `.env`. Keep Compose bindings on `127.0.0.1` and update matching URLs.

### Docker infrastructure is unavailable or unhealthy

Start Docker Desktop and wait for the Linux container engine, then run:

```powershell
docker info
pnpm infra:status
pnpm infra:logs -- postgres
pnpm infra:logs -- redis
```

If initialization failed and the data is disposable, correct the configuration before using the confirmed reset command.

### Dependencies or generated output are stale

```powershell
pnpm clean
pnpm install
```

Do not delete source files or the root lockfile.

### Health check is unavailable

Confirm the API process is running, verify its startup port in the terminal, and request `/health` rather than the root path.

## Stopping the platform

Press `Ctrl+C` in the terminal running `pnpm dev` or `pnpm dev:full`. If prompted to terminate a Windows batch job, confirm it. Then run `pnpm infra:down` so no containers remain running after a demonstration.
