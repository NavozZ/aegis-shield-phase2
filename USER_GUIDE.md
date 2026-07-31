# AEGIS Shield Phase 2 User Guide

This guide explains how to run the Prompt 01 foundation locally. The current platform exposes a customer-facing foundation page and an API health endpoint only; it does not perform banking operations.

## Introduction

AEGIS Shield is a Duothan 6.0 hackathon prototype for resilient and inclusive zero-trust banking. All demonstrations must use synthetic data and fake identities.

## System requirements

- Git
- Node.js `>=20.9`; Node.js 22 is selected by `.nvmrc`
- pnpm `11.8.0`
- Available local TCP ports 3000 and 4000

Confirm the toolchain:

```powershell
node --version
pnpm --version
```

## Installation

Clone and install from the repository root:

```powershell
git clone https://github.com/NavozZ/aegis-shield-phase2.git
Set-Location aegis-shield-phase2
pnpm install
```

Do not run `npm install` or Yarn in this repository. The monorepo uses one root `pnpm-lock.yaml`.

## Environment setup

The foundation applications use safe local defaults. If a local override file is needed, copy the documented template:

```powershell
Copy-Item .env.example .env
```

The resulting `.env` is ignored. Keep every real credential out of Git. For this milestone, `API_PORT` can also be set in the terminal before starting the API. The default is 4000.

## Starting the platform

Start the web application and API gateway together:

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

Stop the process using port 3000 or 4000. For a temporary API-only override:

```powershell
$env:API_PORT = '4100'
pnpm --filter @aegis/api-gateway dev
```

Values outside 1–65535 cause the API to fail safely with a configuration error.

### Dependencies or generated output are stale

```powershell
pnpm clean
pnpm install
```

Do not delete source files or the root lockfile.

### Health check is unavailable

Confirm the API process is running, verify its startup port in the terminal, and request `/health` rather than the root path.

## Stopping the platform

Press `Ctrl+C` in the terminal running `pnpm dev`. If prompted to terminate a Windows batch job, confirm it. Do not leave development servers running after a demonstration.
