# AEGIS Shield Phase 2 User Guide

This guide explains how to run and demonstrate the completed Phase 2 platform: onboarding, secure sign-in, Tier-0 accounts, transaction history, synthetic internal customer transfers, the QR Pay, USSD and agent-cash channels, SABCL encrypted service routing, threat detection with scoped controls, and operational resilience with encrypted backup, restore verification and recovery drills. No external rail or real funds are connected.

> Before demonstrating the USSD or agent-cash channels, read the
> [release blockers](docs/release/final-security-review.md#release-blockers).
> Six confirmed defects in those two channels are documented and not fixed.

## Introduction

AEGIS Shield is a Duothan 6.0 hackathon prototype for resilient and inclusive zero-trust banking. All demonstrations must use synthetic data and fake identities.

## System requirements

- Git
- Node.js `>=22.12`; Node.js 22 is selected by `.nvmrc`
- pnpm `11.8.0`
- Docker Desktop or Docker Engine with Docker Compose v2
- Available local TCP ports 3000, 4000, 4101, 4102, 4103, 4104, 4105, 4106, 5432, and 6379

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

This verifies infrastructure, deploys the committed Identity, Ledger, Payments, Risk and Resilience migrations, and then starts all workspaces. It leaves Docker infrastructure running when `Ctrl+C` stops applications. Normal `pnpm dev` never alters databases.

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

## One-command startup

The fastest route from a fresh clone to a running demonstration:

```powershell
pnpm install --frozen-lockfile
pnpm env:init:local
pnpm env:check
pnpm build
pnpm demo:start
```

`env:init:local` writes `.env` from `.env.example` with cryptographically random
local passwords and tokens, including a valid backup encryption key. It refuses
to overwrite an existing `.env` unless you confirm with
`pnpm env:init:local -- --force`. No value is ever printed, and `.env` is
git-ignored.

`env:check` validates the result. It reports variable names and what is wrong
with them and never displays a value, so it is safe to run with someone looking
over your shoulder.

`demo:start` validates the environment, confirms the Docker engine, starts
PostgreSQL and Redis, applies all five committed migration sets, then brings each
service up in dependency order, waiting on its readiness endpoint. Ctrl+C stops
everything cleanly and preserves your local data.

Once it is running:

```powershell
pnpm demo:status             # what is listening
pnpm demo:verify             # liveness, readiness and response-shape checks
pnpm demo:stop               # stop containers, keep data
pnpm demo:reset -- --yes     # destroy local volumes, on explicit confirmation
```

Complete walkthrough with a presentation script:
[docs/release/FINAL_DEMO_GUIDE.md](docs/release/FINAL_DEMO_GUIDE.md).

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

A new account is opened with a zero balance. No opening entry is written and no funds are invented. Repeating the request returns the same account rather than creating another. Transaction history for the account is available from the account detail view once postings exist.

Full account references and internal ledger identifiers are never shown; only a masked reference such as `AEGIS-****-****-8T3W` is displayed.

### Send a synthetic customer transfer

1. Create a second synthetic customer in another browser context and copy that account's receiving reference.
2. Select **Send money**, choose the source account, enter the recipient reference and an LKR decimal amount, then preview.
3. Verify the masked recipient and exact amount. Enter the sender's PIN for fresh Identity step-up authorization.
4. A completed transfer opens a printable record. A `PROCESSING` result is polled safely; do not submit a new key. Sent/received views, balances, and `TRANSFER` transaction history converge from the same Ledger journal.
5. Wrong PIN, expired preview, insufficient funds, self-transfer, and daily-limit cases show safe messages. PINs, tokens, hashes, and Ledger identifiers are never displayed or stored in browser storage.

Validate the flow with:

```powershell
pnpm payments:test
pnpm payments:test:integration
pnpm payments:test:e2e
pnpm web:test:e2e
pnpm web:test:a11y
pnpm ledger:reconcile
pnpm payments:reconcile
```

See the [repeatable transfer demo](docs/demo/customer-transfer-demo.md).

### Session expiration and logout

Protected routes verify the session with the Gateway before rendering. Expired or revoked sessions redirect to `/sign-in`; an unavailable dependency shows a retryable service-unavailable screen. Select **Log out** to revoke the server session, clear authentication cookies, replace browser history, and return to sign-in.

QR Pay, USSD and agent-assisted journeys are implemented under `/app/channels/qr`, `/app/channels/ussd` and `/app/channels/agent`, and are covered by `pnpm channels:test`. The USSD and agent-cash channels carry documented release blockers and must not be demonstrated as working; see [docs/release/final-security-review.md](docs/release/final-security-review.md#release-blockers).

## Administrator journey

Sign in at `http://localhost:3000/security-ops/sign-in` with the development
operator access token from `.env`. The security operations console shows risk
events, assessments, scoped controls and incidents.

`http://localhost:3000/security-ops/resilience` is the recovery operations
console: platform recovery readiness, per-dependency health, the latest encrypted
backup set, and the recovery drill history. It is read-mostly by design — an
operator can record that a drill is planned and acknowledge a failed one, but
backups and restores are command-line tooling and there is no button that runs
them.

The operator interface is English. Customer journeys remain EN/SI/TA.

## Security demonstration

Implemented in Prompt 10. Full walkthrough:
[docs/demo/risk-controls-demo.md](docs/demo/risk-controls-demo.md).

## SABCL demonstration

Implemented in Prompt 09. Full walkthrough:
[docs/demo/sabcl-routing-demo.md](docs/demo/sabcl-routing-demo.md).

### Setting it up locally

`.env.example` ships placeholders, which strict mode refuses. Generate real
material:

```bash
for service in gateway identity ledger payments sabcl-router; do
  pnpm sabcl:keys -- --service "$service" --version 1
done
pnpm sabcl:keys -- --route-secret
```

Copy the printed `SABCL_*` private lines into your ignored `.env`, collect the
public JSON entries into `SABCL_PEERS`, and set:

```
SABCL_MODE=strict
```

Then `pnpm build && pnpm stack:start`. The router starts on port 4103 between the
services and the gateway.

`SABCL_MODE` accepts `strict` (encrypted, no fallback), `compatible` (documented
local fallback, refused in production) or `off` (pre-Prompt-09 direct calls).

### Viewing the status

Sign in, then open **SABCL** in the workspace navigation, or
<http://localhost:3000/app/sabcl>. It shows the mode, protocol version,
abbreviated key fingerprints, rotation state, capability health, replay state and
envelope counters. It shows no keys, no route tokens, no destinations and no
payloads.

### Verifying the privacy claims

```bash
pnpm sabcl:test:leakage       # no seeded sensitive value appears in an envelope
pnpm sabcl:test               # tampering, expiry, wrong recipient, rotation
pnpm sabcl:test:integration   # replay across router instances (needs infra:up)
pnpm sabcl:test:e2e           # full encrypted journey        (needs infra:up)
```

### What it does not protect

Padding hides exact payload size within a bucket only — timing, frequency and
order-of-magnitude size stay visible. Nothing protects a payload once the
recipient decrypts it. Keys live in process memory, not an HSM. This is an
internal layer between known services, not an anonymity network. See
[docs/security/sabcl-metadata-leakage.md](docs/security/sabcl-metadata-leakage.md).

## Recovery demonstration

Implemented in Prompt 11. Full walkthrough:
[docs/demo/disaster-recovery-demo.md](docs/demo/disaster-recovery-demo.md).

Generate a local backup key and put it in `.env` as `DR_BACKUP_ENCRYPTION_KEY`
before starting. Never commit a key.

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

```powershell
pnpm dr:backup                  # encrypted set of all five databases
```

`dr:backup` prints the backup set identifier and the exact next commands. Every
later command names the set explicitly — a bare verify or restore fails rather
than guessing which set to examine:

```powershell
pnpm dr:backup:verify -- --set <backup-set-id>
pnpm dr:backup:verify:negative -- --set <backup-set-id>
pnpm dr:restore:verify -- --set <backup-set-id>
pnpm dr:drill
```

`--latest` is available when you mean it. It chooses by the manifest's creation
time, never by directory name, and refuses rather than guessing if two sets share
the newest timestamp.

```powershell
pnpm reconcile:all              # Ledger, Payments, Risk and Resilience
```

Delete `.dr-backups/` when the demonstration is finished. A backup set contains
everything the running services protect.

This is a prototype drill against local disposable infrastructure. It provides no
production multi-region disaster recovery, no continuous replication, no zero
data loss, no compliance certification and no guaranteed recovery-point or
recovery-time objective. The console reports a **measured prototype
recovery-point age** and a **measured prototype recovery duration**, which is
exactly what they are.

Runbooks: [disaster recovery](docs/operations/disaster-recovery-runbook.md),
[service failure](docs/operations/service-failure-runbook.md),
[backup and restore](docs/operations/backup-restore-runbook.md).

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

Confirm the application ports are listening (3000, 4000, 4101, 4102, 4103 when SABCL is configured, 4104, 4105, 4106), then inspect only local development logs:

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
