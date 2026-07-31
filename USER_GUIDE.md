# AEGIS Shield Phase 2 User Guide

This guide explains how to run and demonstrate the Prompt 05 customer onboarding, secure sign-in, and Tier-0 account experience. The platform performs no money movement; the authenticated workspace clearly marks deferred features.

## Introduction

AEGIS Shield is a Duothan 6.0 hackathon prototype for resilient and inclusive zero-trust banking. All demonstrations must use synthetic data and fake identities.

## System requirements

- Git
- Node.js `>=22.12`; Node.js 22 is selected by `.nvmrc`
- pnpm `11.8.0`
- Docker Desktop or Docker Engine with Docker Compose v2
- Available local TCP ports 3000, 4000, 4101, 5432, and 6379

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

This verifies infrastructure, deploys committed Identity migrations, and then starts all workspaces. It leaves Docker infrastructure running when `Ctrl+C` stops applications. Normal `pnpm dev` never alters databases.

For a local demonstration, keep `DEMO_AUTH_ENABLED=true`. This causes the API to return a one-time demonstration OTP to the browser. It is rejected in production mode and must never be treated as an OTP delivery design.

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

No production or seeded users are committed. Demo OTP is local/test-only and appears only when `DEMO_AUTH_ENABLED=true`; production startup rejects that mode. Always use synthetic example-style phone data.

## Testing authentication

Start infrastructure and apply the committed migration:

```powershell
pnpm infra:up
pnpm infra:check
pnpm db:validate:identity
pnpm db:generate
pnpm db:deploy:identity
```

Run deterministic and real-infrastructure authentication tests:

```powershell
pnpm auth:test
pnpm auth:test:e2e
pnpm web:test
pnpm web:e2e:install
pnpm web:test:e2e
pnpm web:test:a11y
```

The API e2e suite calls onboarding and sign-in only through the Gateway. The Chromium suite additionally performs the real browser WebAuthn ceremony with a virtual authenticator, validates fallback sign-in, checks responsive layouts, and runs axe accessibility checks. Browser harnesses clean only their named synthetic records and stop their controlled processes and containers.

## Customer journeys

Open `http://localhost:3000`. Choose English, Sinhala, or Tamil from the interface-language selector; the preference is the only authentication-related value stored in browser storage.

### Create secure access

1. Select **Create secure access**.
2. Enter a synthetic E.164 number, select the interface language, accept the demonstration consent, and request a code.
3. In local demo mode only, enter the OTP displayed after the API returns it. The OTP is short-lived and single-use. Never enter a real OTP or real phone number.
4. Create and confirm a six-digit PIN. Repeated digits, common values, and obvious ascending or descending sequences are rejected.
5. Add a passkey when supported, or skip it for now. Passkeys are recommended because the device performs user verification and AEGIS receives only public-key credential material—not a fingerprint, face scan, or device unlock secret.
6. Continue to `/app`. Masked identity, session status, and the Tier-0 account panel are shown.

Reloading midway through onboarding clears the phone, OTP, enrollment token, and PIN flow state. Restart the flow rather than trying to recover those values from browser storage.

### Sign in

The **Sign in with passkey** action is primary. A supported browser prompts the registered authenticator and returns to the protected workspace after successful verification.

If no passkey is available, choose **Use phone, PIN and OTP**. Enter the synthetic phone and PIN, request the one-time code, then complete sign-in. Errors remain deliberately generic to reduce account enumeration.

### Create a Tier-0 account

The **Accounts and balances** panel on `/app` first shows **No account created yet** with a short explanation of the Tier-0 wallet.

Select **Create Tier-0 account**. The request carries a generated idempotency key and the CSRF header, and the button is disabled while it is in flight, so a double click cannot create a second account. On success the panel shows the masked account reference, the account product, status, currency, and a balance of exactly `LKR 0.00`.

A new account is opened with a zero balance. No opening entry is written and no funds are invented. Repeating the request returns the same account rather than creating another. Transaction history arrives in Prompt 06.

Full account references and internal ledger identifiers are never shown; only a masked reference such as `AEGIS-****-****-8T3W` is displayed.

### Session expiration and logout

Protected routes verify the session with the Gateway before rendering. Expired or revoked sessions redirect to `/sign-in`; an unavailable dependency shows a retryable service-unavailable screen. Select **Log out** to revoke the server session, clear authentication cookies, replace browser history, and return to sign-in.

Transfers, transaction history, QR payments, USSD, and agent-assisted journeys remain deferred.

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

### The web app shows that the secure service is unavailable

Confirm all three application ports are listening, then inspect only local development logs:

```powershell
Invoke-RestMethod http://localhost:4000/health
Invoke-RestMethod http://localhost:4000/health/ready
Invoke-RestMethod http://127.0.0.1:4101/health/live
```

Run `pnpm infra:check` if Gateway readiness reports an Identity dependency failure. Do not paste cookies, PINs, OTPs, phone numbers, or environment values into issue reports.

### Passkeys are unavailable or cancelled

Use a current browser on `http://localhost:3000`, which must match the configured WebAuthn origin and RP ID. Cancelling the device prompt does not lock the account; retry or use PIN/OTP fallback. This prototype does not provide production authenticator recovery.

## Stopping the platform

Press `Ctrl+C` in the terminal running `pnpm dev` or `pnpm dev:full`. If prompted to terminate a Windows batch job, confirm it. Then run `pnpm infra:down` so no containers remain running after a demonstration.
