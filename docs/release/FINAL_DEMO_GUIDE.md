# AEGIS Shield — Final Demonstration Guide

This is the definitive guide to running and presenting AEGIS Shield, the Duothan 6.0
Phase 2 prototype. It covers everything from a clean machine to a timed stage
presentation: what to install, what one command does, which URL to open at which
moment, what to say about each screen, what goes wrong and how to recover, and —
just as importantly — what this system does **not** do.

Everything here was checked against the repository. Every command appears in the
root [`package.json`](../../package.json) scripts, every URL corresponds to a page
under `apps/web/src/app`, and every port matches the running configuration.

> **Use synthetic data only.** Never enter a real phone number, a real PIN, a real
> account reference, real money or a real credential. This is a hackathon
> prototype, not a bank.

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Environment initialization](#2-environment-initialization)
3. [One-command startup](#3-one-command-startup)
4. [Ports](#4-ports)
5. [Customer journey](#5-customer-journey)
6. [Transfer journey](#6-transfer-journey)
7. [Inclusive-channel journey](#7-inclusive-channel-journey)
8. [SABCL: what an observer sees](#8-sabcl-what-an-observer-sees)
9. [Risk incident and control journey](#9-risk-incident-and-control-journey)
10. [Resilience journey](#10-resilience-journey)
11. [The disaster-recovery drill](#11-the-disaster-recovery-drill)
12. [Stopping and resetting](#12-stopping-and-resetting)
13. [Troubleshooting](#13-troubleshooting)
14. [Prototype limitations](#14-prototype-limitations)
15. [Presentation script](#15-presentation-script)

---

## 1. Prerequisites

| Requirement                                                  | Version                                                                      | Why it is needed                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| Git                                                          | any current release                                                          | Cloning the repository                                   |
| Node.js                                                      | `22` as selected by [`.nvmrc`](../../.nvmrc); `engines` requires `>=22.12`   | Runs every service, the web app and all tooling          |
| pnpm                                                         | `11.8.0`, pinned by `packageManager` in [`package.json`](../../package.json) | One workspace, one lockfile                              |
| Docker Desktop or Docker Engine with Compose v2              | any version whose engine actually starts                                     | PostgreSQL and Redis only; nothing else is containerised |
| PostgreSQL 17 client tools (`pg_dump`, `pg_restore`, `psql`) | 17.x                                                                         | The disaster-recovery tooling shells out to them         |
| A passkey-capable browser                                    | current Chrome, Edge, Safari or Firefox                                      | WebAuthn registration and sign-in                        |

Enable pnpm through Corepack if it is not already available:

```powershell
corepack enable
corepack prepare pnpm@11.8.0 --activate
```

Confirm the toolchain before you do anything else:

```powershell
node --version
pnpm --version
docker info
pg_dump --version
```

### Why PostgreSQL 17 specifically

[`docker-compose.yml`](../../docker-compose.yml) runs `postgres:17.10-alpine`. A
`pg_dump` older than the server refuses to dump it, and that refusal is correct —
an older client cannot be trusted to represent a newer catalogue. If your machine
has PostgreSQL 15 or 16 client tools on `PATH`, sections
[11](#11-the-disaster-recovery-drill) will fail while everything else works. CI
installs `postgresql-client-17` explicitly for exactly this reason.

### Install dependencies

```powershell
pnpm install --frozen-lockfile
```

Do not use `npm` or Yarn here. The monorepo has a single root `pnpm-lock.yaml`.

---

## 2. Environment initialization

The repository ships [`.env.example`](../../.env.example) with placeholder values.
Placeholders are deliberately unusable: the backup key placeholder decodes to the
wrong length and is refused, and the SABCL key placeholders are rejected at
startup. You never edit `.env.example`. You generate an ignored `.env` from it.

```powershell
pnpm env:init:local
```

This copies `.env.example` line by line — comments, ordering and non-secret values
are preserved so the result stays diffable against the template — and replaces
every secret with fresh cryptographically random material. It then **rebuilds
every connection URL from its regenerated components**, so a new database password
cannot leave `LEDGER_DATABASE_URL` pointing at the old one. That class of mistake
otherwise surfaces hours later as a role that cannot connect.

It refuses to overwrite an existing `.env`. To replace one deliberately:

```powershell
pnpm env:init:local -- --force
```

The previous file is copied to `.env.replaced`, which is also git-ignored.

SABCL private keys are **not** generated here. They are X25519 and Ed25519
material produced by `pnpm sabcl:keys`, and `SABCL_MODE` ships as `off` so that a
freshly initialised file starts a working stack on the first try. See
[section 8](#8-sabcl-what-an-observer-sees) to turn it on.

Then validate:

```powershell
pnpm env:check
```

### No value is ever printed

This is the property that makes `env:check` safe to run on a projector, in a CI
log or over a screen share. The checker reports **variable names and problem
descriptions only**:

```text
[env] NODE_ENV=development
[env] 2 configuration problems:
  invalid  DR_BACKUP_ENCRYPTION_KEY — must decode to exactly 32 bytes
  invalid  REDIS_URL — has no password; Redis must require authentication
[env] configuration is incomplete; no values were displayed
```

A validator that echoed the offending value would put a password into a terminal
scrollback or a screenshot — precisely the disclosure the configuration exists to
prevent. Even the unexpected-error path prints a fixed string rather than an
exception message, because an exception message can quote a line of `.env`.

What `env:check` actually verifies, beyond presence: every port is an integer in
range and no two services claim the same one; every PostgreSQL URL parses, names a
valid database and carries a login role and password; each service URL names the
database and role that the initialization script actually creates; Redis requires
authentication; `FIELD_ENCRYPTION_KEY` and `DR_BACKUP_ENCRYPTION_KEY` decode to
exactly 32 bytes and are not all zero; `SABCL_MODE` is one of `off`, `compatible` or `strict`,
and when it is not `off`, that every SABCL key is present and is not a shipped
placeholder. With `NODE_ENV=production` it additionally refuses `DEMO_AUTH_ENABLED=true`,
any operator bootstrap token, `SABCL_MODE=compatible`, a localhost WebAuthn
origin, and any secret still carrying a shipped placeholder.

`.env` is git-ignored and must never be committed.

### Build once before the first start

```powershell
pnpm build
```

`pnpm demo:start` runs compiled output (`services/*/dist/main.js`,
`apps/api-gateway/dist/main.js`, and the Next.js production server for the web
app). If a build is missing it stops and tells you:
`[demo] <service> build output is missing. Run: pnpm build`.

---

## 3. One-command startup

```powershell
pnpm demo:start
```

It executes this plan, in this order, stopping at the first failure:

| #   | Step                        | What it does                                                                                                                          | On failure                                                           |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | Validate environment        | Runs `env:check`                                                                                                                      | Prints `Run: pnpm env:init:local` and stops                          |
| 2   | Check the Docker engine     | `docker info`                                                                                                                         | Prints `the Docker engine is not available. Start Docker and retry.` |
| 3   | Start infrastructure        | `infra:up` — PostgreSQL and Redis with `--wait`                                                                                       | Stops                                                                |
| 4   | Check infrastructure health | `infra:check` — readiness, authenticated Redis `PING`, all service databases, all service roles, database ownership, container health | Stops                                                                |
| 5   | Apply migrations            | `db:deploy` — all five committed migration sets                                                                                       | Stops                                                                |
| 6   | Identity                    | port 4101, waits for `/health/live`                                                                                                   | Shuts down what it started                                           |
| 7   | Ledger                      | port 4102, waits for `/health/live`                                                                                                   | Shuts down what it started                                           |
| 8   | SABCL router                | port 4103, waits for `/health/live` — **skipped when `SABCL_MODE=off`**                                                               | Shuts down what it started                                           |
| 9   | Payments                    | port 4104, waits for `/health/live`                                                                                                   | Shuts down what it started                                           |
| 10  | Risk                        | port 4105, waits for `/health/live`                                                                                                   | Shuts down what it started                                           |
| 11  | Resilience                  | port 4106, waits for `/health/live`                                                                                                   | Shuts down what it started                                           |
| 12  | API Gateway                 | port 4000, waits for `/health`                                                                                                        | Shuts down what it started                                           |
| 13  | Web                         | port 3000, waits for `/`                                                                                                              | Shuts down what it started                                           |

The order is not cosmetic. The blind router starts **after** the services it
forwards to and **before** the gateway that sends through it, so a strict-mode
gateway comes up with a reachable router instead of failing its first call.

Every wait polls a health endpoint on a bounded schedule rather than sleeping for
a guessed interval, and every child's output is passed through a redactor before
it reaches your terminal — values of variables whose names match
`PASSWORD|TOKEN|SECRET|PRIVATE_KEY|_KEY$|DATABASE_URL|REDIS_URL` are replaced with
`[redacted]`, as is any URL userinfo assembled at runtime.

When it is up you get a table and three lines:

```text
  SERVICE      PORT   STATE
  -----------  -----  -----
  Identity     4101   ready
  Ledger       4102   ready
  Payments     4104   ready
  Risk         4105   ready
  Resilience   4106   ready
  Gateway      4000   ready
  Web          3000   ready

[demo] open http://localhost:3000
[demo] verify with: pnpm demo:verify
[demo] press Ctrl+C to stop; local data is preserved
```

`demo:start` stays in the foreground. Open a second terminal for everything else.

### Checking the running stack

```powershell
pnpm demo:status     # what is listening: ready, degraded, failed, unreachable, skipped
pnpm demo:verify     # liveness, readiness and response-shape checks
```

`demo:verify` is stricter than `demo:status`. It probes liveness on every service,
probes readiness where a service has a distinct readiness document, and then holds
each response to its documented **shape**: liveness must contain `status`; the
Gateway readiness document must contain `status` and `dependencies`; the
Resilience readiness document must contain `status`, `database` and
`backupKeyConfigured`. It fails if any health response contains
`databaseUrl`, `redisUrl`, `password`, `token`, `internalToken`, `encryptionKey`,
`backupKey` or `stack`, or if a PostgreSQL or Redis connection string appears
anywhere in the document. A readiness endpoint answering 503 is reported as
`degraded` — it is doing its job — rather than treated as a broken service.

A pass ends with:

```text
[demo] every service answered and every response matched its documented shape
```

---

## 4. Ports

| Component          | Port | Bound to                                         | Reachable from a browser                                                         |
| ------------------ | ---- | ------------------------------------------------ | -------------------------------------------------------------------------------- |
| Web (Next.js)      | 3000 | the machine                                      | Yes — this is the only page you open                                             |
| API Gateway        | 4000 | `127.0.0.1`                                      | Yes, via the web app; CORS allows only `http://localhost:3000`, with credentials |
| Identity service   | 4101 | `127.0.0.1`                                      | No                                                                               |
| Ledger service     | 4102 | `127.0.0.1`                                      | No                                                                               |
| SABCL blind router | 4103 | `127.0.0.1`                                      | No — and it starts only when `SABCL_MODE` is not `off`                           |
| Payments service   | 4104 | `127.0.0.1`                                      | No                                                                               |
| Risk service       | 4105 | `127.0.0.1`                                      | No                                                                               |
| Resilience service | 4106 | `127.0.0.1`                                      | No                                                                               |
| PostgreSQL         | 5432 | published as `127.0.0.1:5432`                    | No                                                                               |
| Redis              | 6379 | published as `127.0.0.1:6379`, password required | No                                                                               |

The API Gateway is the single browser-facing API. It sets `helmet` headers, caps
JSON bodies at 32 KiB, whitelists and rejects unknown request properties, and
allows only `GET`, `POST`, `HEAD` and `OPTIONS`. Identity, Ledger, Payments, Risk
and Resilience each apply an internal service-token guard to every route, so even
a process on the same machine cannot call Payments or Ledger without
configuration it does not have.

Each of the five databases has its own least-privilege login role:
`aegis_identity`, `aegis_ledger`, `aegis_payments`, `aegis_audit` (owned by Risk)
and `aegis_resilience`.

---

## 5. Customer journey

Open **<http://localhost:3000>**.

| Step                | URL                                                      | What to show                                                                                           |
| ------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Landing             | `/`                                                      | Language selector: English, Sinhala, Tamil. The whole page re-renders, including the prototype notice. |
| Onboarding          | `/onboarding`                                            | Tier-0 phone onboarding                                                                                |
| Sign-in             | `/sign-in`                                               | Passkey first, phone/PIN/OTP fallback                                                                  |
| Workspace           | `/app`                                                   | Account panel, recent activity, session status, channel cards                                          |
| Security settings   | `/app/security`                                          | Passkey enrollment, session and fallback notices                                                       |
| Account and history | `/app/accounts/<accountId>`                              | Filterable, cursor-paged transaction history                                                           |
| Transaction record  | `/app/accounts/<accountId>/transactions/<transactionId>` | Printable record                                                                                       |

### Onboarding

1. Choose **Create secure access**.
2. Enter a synthetic E.164 phone number. Pick a language and accept consent.
3. Request the verification code.
4. The page displays a **local demonstration OTP**. Say what it is: the local API
   returned a `demoOtp` field because `DEMO_AUTH_ENABLED=true` in this ignored
   `.env`. The web app did not generate or guess it. `env:check` refuses that flag
   when `NODE_ENV=production`. The stored challenge is a keyed digest, never the
   code itself.
5. Enter the code, then create and confirm a six-digit PIN. The PIN is hashed with
   Argon2id.
6. The completion view and `/app` show **masked** customer data only.

Reloading a half-finished flow clears the sensitive in-memory state rather than
resuming it.

### Passkey

At onboarding or on `/app/security`, choose to add a passkey and complete the
browser or operating-system prompt. Say plainly that the biometric and the device
unlock secret never leave the device; the server stores a public credential.

Log out, then choose **Sign in with passkey** and complete user verification. The
workspace reports which method authenticated the session. If the demonstration
machine has no authenticator, show the explanatory unavailable state — do not
claim a ceremony completed that did not.

### Fallback sign-in

Log out and choose phone, PIN and OTP. Same synthetic phone, same demonstration
PIN, a fresh local demonstration OTP. The workspace reports PIN and OTP
authentication.

### Session protection

Log out, then navigate directly to `http://localhost:3000/app`. It redirects to
`/sign-in`. The session is an opaque, revocable value in Redis; logout revokes it
server-side and clears the cookies. The session cookie is `HttpOnly`; the CSRF
cookie is deliberately readable so the browser can echo it in a header, which is
what makes the double-submit check meaningful.

### Dashboard and history

`/app` shows the account panel, the five most recent transactions and the session
card with its expiry. Open the account to reach the full history at
`/app/accounts/<accountId>`, which supports `direction`, `category`, `dateFrom`,
`dateTo`, `pageSize` and `cursor`. Cursors are versioned and opaque. Open any row
for the printable record at
`/app/accounts/<accountId>/transactions/<transactionId>`.

Money is integer minor units end to end: `BIGINT` in PostgreSQL, `BigInt` in
service code, decimal strings on the wire. There is no floating point anywhere in
the money path.

Related: [authentication demo](../demo/authentication-demo.md),
[accounts and ledger demo](../demo/accounts-ledger-demo.md),
[dashboard and transactions demo](../demo/dashboard-transactions-demo.md).

---

## 6. Transfer journey

| Step            | URL                           |
| --------------- | ----------------------------- |
| Transfer list   | `/app/transfers`              |
| New transfer    | `/app/transfers/new`          |
| Transfer record | `/app/transfers/<transferId>` |

**1. Intent.** Enter a recipient reference and an amount, then preview. The
gateway calls `POST /api/v1/transfers/preview`, which requires the session cookie
and a matching `x-csrf-token` header. Payments returns a short-lived **intent
token** plus masked previews of both sides and the source balance. Nothing has
moved. The intent expires (`PAYMENTS_INTENT_TTL_SECONDS`, 300 seconds in the
template), which bounds how long an authorisation is worth stealing.

**2. PIN step-up.** Confirming asks for the six-digit PIN again. This is not a
form validation: the gateway calls the **Identity** service to verify it, so the
PIN is checked by the service that owns credentials and never by the service that
moves money. Failures are counted in Redis;
`TRANSFER_STEP_UP_MAX_ATTEMPTS` (5) consecutive failures set a lock for
`TRANSFER_STEP_UP_LOCK_SECONDS` (300). A wrong PIN and an unknown user take the
same path — a dummy verification runs on failure so the response time does not
distinguish them.

Show this: enter a wrong PIN once. The message is generic ("Authorization
failed"), and the Identity service records a `TRANSFER_STEP_UP` / `FAILURE` audit
event which it forwards to Risk as a `PIN_FAILURE` at `MEDIUM` severity. That is
the seed for [section 9](#9-risk-incident-and-control-journey).

**3. Risk gate.** Before the step-up, the gateway asks Risk whether an active
control blocks this customer, this session or the transfer-confirmation operation.
After the step-up it asks for a decision. Anything other than `ALLOW` or
`ALLOW_WITH_MONITORING` refuses the transfer with a generic message.

**4. Idempotent confirmation.** The browser generates an idempotency key once and
reuses it for every retry of the same confirmation. The gateway **requires** the
`idempotency-key` header (16–128 characters of `A-Za-z0-9._:-`) and returns
`IDEMPOTENCY_KEY_REQUIRED` without one. Confirming twice with the same key yields
the same transfer, not a second one. Show it: confirm, then reload and let the
component re-confirm, and point at the single record.

**5. Settlement and receipt.** Payments orchestrates; **Ledger is the sole balance
authority**. The posting is an immutable `CUSTOMER_TRANSFER` journal with balanced
double-entry postings, deterministic account lock ordering and a deferred database
constraint that refuses to commit an unbalanced journal. A confirmation may return
`PROCESSING` (HTTP 202); the transfer record at `/app/transfers/<transferId>`
polls until it settles, and bounded recovery retries a stuck transfer a limited
number of times rather than forever.

Finish by opening the printable receipt and switching language to Sinhala or Tamil
to show the receipt is localised too.

Related: [customer transfer demo](../demo/customer-transfer-demo.md),
[fund transfer model](../security/fund-transfer-model.md),
[payment idempotency and recovery](../security/payment-idempotency-and-recovery.md).

---

## 7. Inclusive-channel journey

Three channels for people who do not have a smartphone, a data connection, or a
bank branch within reach. All three are reachable from the cards on `/app`.

| Channel    | Page                  | Gateway API                                                                                     |
| ---------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| QR Pay     | `/app/channels/qr`    | `POST /api/v1/channels/qr/receive`, `/qr/dynamic`, `/qr/preview`, `/qr/confirm`                 |
| USSD       | `/app/channels/ussd`  | `POST /api/v1/channels/ussd/simulate`, `/ussd/webhook`                                          |
| Agent cash | `/app/channels/agent` | `POST /api/v1/channels/agent/cash-in/preview`, `/agent/cash-out/preview`, `/agent/cash/confirm` |

### QR Pay

A payload is a base64url-encoded JSON object carrying a protocol version, the
recipient reference, currency, an optional amount, a random 16-byte nonce, an
expiry, the type, an optional purpose, a key identifier and an **HMAC-SHA-256
signature** over a canonical serialisation of those fields. Verification is a
constant-time comparison of equal-length buffers.

- **Dynamic** codes carry an amount and expire in `PAYMENTS_QR_DYNAMIC_TTL_SECONDS`
  (300 seconds in the template). Issued by `POST /api/v1/channels/qr/dynamic`.
- **Static** codes carry no amount and live for `PAYMENTS_QR_STATIC_TTL_HOURS`
  (8760 hours). Issued by `POST /api/v1/channels/qr/receive`.

On `/app/channels/qr`, paste a payload into the scanner form to reach the preview.
The preview verifies version, signature and expiry before showing anything, and
returns the same masked preview shape a normal transfer preview returns.
Confirmation goes through `POST /api/v1/channels/qr/confirm`, which requires PIN
step-up at Identity and an `idempotency-key` header exactly like a transfer.

Three refusals worth demonstrating, all covered by `pnpm channels:test:qr`:

- flip one character of the payload — the signature check fails;
- wait past the expiry — the code is refused on time, not on use;
- confirm the same code twice — the redemption is recognised as a replay and the
  original result is returned rather than a second settlement.

### USSD

`/app/channels/ussd` is a simulator for a feature-phone session. Dial `*123#` to
get the menu: `1. Balance`, `2. Send Money`, `3. Exit`. Send Money walks through
recipient reference, amount, confirmation and PIN.

Session state is **bounded and expiring**: it lives in Redis under the payments
key prefix with a 300-second time to live, so an abandoned session disappears on
its own rather than accumulating. A telco integration has no browser session and
no CSRF token, which is why `POST /api/v1/channels/ussd/webhook` carries neither —
but the Payments service applies an internal-token guard to **every** route
including the USSD handler, so the webhook is not an unauthenticated path into
Payments, and the browser cannot reach the USSD handler directly at all.

Covered by `pnpm channels:test:ussd`.

### Agent cash

`/app/channels/agent` has cash-in and cash-out preview forms. Both resolve the
customer by public reference through the Ledger, then enforce, in order: minimum
amount, maximum per transaction (`PAYMENTS_MAX_TRANSFER_MINOR`), and a **per-agent
daily total** computed from that agent's completed operations since midnight UTC
against `PAYMENTS_DAILY_OUTGOING_LIMIT_MINOR`. Exceeding either limit returns
`LIMIT_EXCEEDED` and nothing is created.

A successful preview returns an intent token with the same short expiry as a
transfer. `POST /api/v1/channels/agent/cash/confirm` requires PIN step-up and an
`idempotency-key`, and an expired operation is refused rather than quietly
extended.

Covered by `pnpm channels:test:agent`.

Design, threats and limits: [inclusive channels threat model](../security/inclusive-channels-threat-model.md).

---

## 8. SABCL: what an observer sees

SABCL — the Security-Aware Blind Communication Layer — is the project's signature
idea. Its claim is narrow and worth stating precisely: **a router in the middle of
the path can decide where a message goes without learning what it says or whom it
concerns.**

It ships `off` so a fresh clone starts a working stack. To demonstrate it, generate
real key material first:

```powershell
pnpm sabcl:keys -- --service gateway --version 1
pnpm sabcl:keys -- --route-secret
```

Repeat for `identity`, `ledger`, `payments` and `sabcl-router`, copy the private
lines into `.env`, collect the public entries into `SABCL_PEERS`, and set
`SABCL_MODE=strict`. Then `pnpm env:check` and restart. One name does not match
literally: the generator prints the router's variables from its service name, but
the template's prefix for `sabcl-router.v1` is `SABCL_ROUTER_`, so paste those two
private values under `SABCL_ROUTER_ENCRYPTION_PRIVATE_KEY` and
`SABCL_ROUTER_SIGNING_PRIVATE_KEY`. The prefix table is in
[key management](../security/sabcl-key-management.md).

**Show the refusal first.** With placeholders still in place, `env:check` reports
`is still a placeholder; run pnpm sabcl:keys` and the router refuses to start. It
fails at startup, not on the first request: a router that cannot authenticate
senders should not be accepting traffic at all.

### Before

Without SABCL, an internal call between the gateway and the ledger is ordinary
HTTP on loopback. Anyone who can see that traffic — a compromised sidecar, a
misconfigured log shipper, an intercepting proxy — reads the endpoint path, the
operation, the customer identifier, the account identifier and the amount.
Encrypting the transport hides the bytes from the network but not from the
middlebox that terminates it.

### After

With `SABCL_MODE=strict`, the gateway seals every integrated call before it leaves
the process:

```text
epk, esk  ←  fresh X25519 key pair (one message, then discarded)
ss        ←  X25519(esk, recipient encryption public key)
k         ←  HKDF-SHA-256(ikm = ss, salt = nonce,
                          info = "SABCL/1 request-key" ‖ canonical header)
ct, tag   ←  AES-256-GCM(k, nonce, pad(payload), aad = canonical header)
sig       ←  Ed25519(sender signing key, "SABCL/1 request-signature" ‖ header ‖ ct ‖ tag)
```

The outer envelope the router sees contains exactly this: protocol version `v`; a
random 128-bit message id `mid`; an opaque route token `rt`; sender and recipient
key ids `skid` and `rkid`; the sender's single-use ephemeral public key `epk`;
`iat` and `exp`; the AES-GCM nonce `n`; the remaining hop count `hl`; the padded
plaintext length `pad`; and `ct`, `tag`, `sig`.

**Absent by design**: endpoint paths, operation names, customer identifiers,
account identifiers, amounts, recipient references, authentication assertions and
PIN authorisation. All of those live inside `ct`. The envelope schema is
`.strict()`, so an added field is a parse failure rather than a silent leak.

A router log line for a real call looks like this and contains nothing else:

```json
{
  "event": "envelope.accepted",
  "messageDigest": "3d61aa70a628",
  "routeDigest": "47fde8407e9f",
  "senderKeyId": "gateway.v1",
  "durationMs": 18
}
```

### Why the router cannot read

Three independent reasons, and the third is the one that matters:

1. **It holds no recipient decryption key.** The router's configuration maps route
   tokens to destination URLs, not to keys. The ciphertext is opaque bytes to that
   process by construction, not by policy.
2. **The shared secret is derived per message** from the sender's ephemeral X25519
   key and the recipient's public key. The router has neither private half.
3. **A route token is not a destination.** It is
   `base64url(HMAC-SHA-256(routeSecret, "SABCL/1 route-token" ‖ routeId))`, and a
   route id names a **capability** such as `ledger.accounts`, never a path. The
   mapping from capability to concrete internal path lives only in the recipient.
   So the router is not a general HTTP proxy: there is no request shape that names
   a destination, and an attacker-chosen token is a lookup miss rather than a URL.
   Resolution compares every candidate in constant time and always runs the full
   loop, so an unknown token and a revoked one are indistinguishable by timing.

The router deliberately does **not** verify sender signatures, even though it
holds the public keys. If the router were the only element checking authenticity,
a compromised router could accept or drop traffic on a criterion nobody re-checks.
The recipient verifies, so a lying router is caught at the far end. The router
checks only what it must to route safely: version, freshness, sender-key
allowlist, hop budget (`hl` ∈ [0, 4]), rate limit, route resolution, and replay —
`mid` is claimed atomically in Redis with `SET NX EX`.

Error codes are coarse on purpose. Unknown sender, unknown recipient, revoked key,
invalid signature and failed decryption all return HTTP 401, so probing with
different key identifiers reveals nothing about which check failed.

### The operator view and the proof

Sign in and open **`/app/sabcl`**. It shows the mode, key fingerprints
(`gateway.v1:9f3c1a` — three bytes of a 32-byte key: enough to confirm two
deployments match, useless to an attacker), the rotation table, and route health
by **capability name, never destination URL**. The page states its own scope: it
is a status view, not a security control.

Then run the proof:

```powershell
pnpm sabcl:test:leakage
```

It seeds a payload with marked values in every sensitive category — customer id,
account id, amount, recipient reference, endpoint path, operation name, session
assertion, PIN authorisation — and asserts none of them appears anywhere in the
serialised envelope as a raw string, base64, base64url, hex or percent-encoding.

### What SABCL does not do

Padding hides exact payload size **within a bucket** (512 B, 1 K, 2 K, 4 K, 8 K,
16 K, 32 K, 64 K) and nothing more. Timing and traffic volume are not hidden.
Forward secrecy is one-sided: the sender's ephemeral key is discarded, the
recipient's long-term key is not. And nothing protects a payload once the
recipient has decrypted it.

Full detail: [SABCL protocol](../security/sabcl-protocol.md),
[metadata leakage analysis](../security/sabcl-metadata-leakage.md),
[key management](../security/sabcl-key-management.md),
[routing demo](../demo/sabcl-routing-demo.md).

---

## 9. Risk incident and control journey

The security-operator console is a **separate** authentication domain from
customer banking. It never shares a session with a customer.

### Getting in

Set a random development-only value for `RISK_OPERATOR_BOOTSTRAP_TOKEN` in `.env`
before starting the stack — it is commented out in the template and is refused
outright when `NODE_ENV=production`. Then open
**<http://localhost:3000/security-ops/sign-in>** and paste it.

### Producing something to look at

Everything below uses events the platform generates itself; nothing is faked into
the database.

1. Complete one normal transfer. That emits `TRANSFER_PREVIEW` and
   `TRANSFER_CONFIRMATION` at `INFO`.
2. Start another transfer and enter the **wrong PIN** several times. Identity
   records each failure and forwards it to Risk as `PIN_FAILURE` at `MEDIUM`; the
   fifth failure locks step-up and raises the forwarded severity to `HIGH`.
3. Watch the score climb.

Scoring is deterministic and integer-weighted — rule set `risk-rules-2026-08-v1`,
capped at 100, banded LOW 0–24, MEDIUM 25–49, HIGH 50–74, CRITICAL 75–100. LOW
allows; a nonzero low score allows with monitoring; MEDIUM requires fresh step-up
unless already verified; HIGH holds for review; CRITICAL quarantines. A known
active block takes priority over the aggregate score. There is no model, no
training data and no randomness: the same events always produce the same decision,
and the triggered rule codes and reason codes are **persisted with the
assessment** so the explanation survives.

### On `/security-ops`

- **Overview** — events in the last 24 hours, active controls, open incidents,
  high/critical assessments, the risk distribution, and per-source ingestion
  health with a staleness flag. A source that stops reporting is itself a signal.
- **Recent security events** — filterable by source and severity. Subject
  identifiers are **masked** in the table (`abcd…123456`), because an operator
  console is still a place customer data can leak from.
- **High / critical assessments** — score, band, decision, triggered rules, reason
  codes and the stored public explanation.
- **Open incidents** — append-only, opened by the platform.
- **Active controls** — type, scope, reason code and expiry, each with a
  **Release** action.

### The control

Open the incident at `/security-ops/incidents/<incidentId>`. Show the assessment
explanation, the linked controls and the append-only timeline. Use **Assign and
investigate**, add a note, then **Resolve** or mark **False positive**.

Then release the control from the dashboard. Releasing prompts for an audited
reason of at least eight characters — a control released without a recorded reason
is an untraceable change to a security posture.

The point to make out loud: controls are **scoped and expiring**, and they are
enforced **independently at three places** — the API Gateway, the Payments service
and the Identity service. A control is not a flag the UI honours; it is checked by
each service that could act on it, so bypassing one does not bypass the others.
While a control is active, retrying the transfer is refused with a generic
`SECURITY_CONTROL_ACTIVE`, which tells an attacker nothing about which rule fired.

Related: [risk rule catalogue](../security/risk-rule-catalogue.md),
[automated control policy](../security/automated-control-policy.md),
[operator authorization model](../security/operator-authorization-model.md),
[risk failure policy](../security/risk-failure-policy.md),
[threat detection and controls](../architecture/threat-detection-and-controls.md),
[risk controls demo](../demo/risk-controls-demo.md).

---

## 10. Resilience journey

Open **<http://localhost:3000/security-ops/resilience>**, behind the same operator
gate.

- **Platform recovery readiness** — platform state, and the two measurements from
  the most recent drill: **measured prototype recovery-point age** and **measured
  prototype recovery duration**. The page itself carries the footnote that these
  are measurements against local disposable infrastructure and are not a
  production recovery-point or recovery-time objective. Read that footnote aloud.
- **Service and dependency state** — per service and per dependency
  (`POSTGRES`, `REDIS`, `HTTP_SERVICE`), stated in **words as well as colour** so
  state is never conveyed by hue alone.
- **Latest encrypted backup set** — identifier, creation time, databases covered,
  algorithm, abbreviated manifest checksum, encrypted size, and whether a restore
  has ever verified it.
- **Recovery drill history** — newest first, with both measurements, and an
  **Acknowledge** action on a failed drill. **Record a planned drill** records
  intent.

Now show what is deliberately **not** there: no button that runs a backup, no
button that runs a restore, no file path, no database URL, no key. That work is
operator command-line tooling, because a console button that shells out is remote
command execution wearing a nicer label. The Resilience service records evidence;
it does none of the recovery work itself.

### A controlled failure

Stop the Risk service and refresh the console. Platform state becomes `DEGRADED`
and Risk reads `UNAVAILABLE`. Nothing hangs, and no address is disclosed. Restart
Risk and refresh: `HEALTHY` on the very next call, with no restart of the
Resilience service and no cached verdict to clear.

### The evidence cannot be rewritten

```powershell
pnpm resilience:reconcile
```

Then, in `psql`, try to rewrite history:

```sql
UPDATE app.drill_events SET note = 'rewritten' WHERE state = 'PLANNED';
```

PostgreSQL raises `resilience drill history is append-only`. The same happens for
`DELETE`, and for any change to a backup set's identifier, checksum, creation
time, service list or size.

Related: [operational resilience and DR](../architecture/operational-resilience-and-dr.md),
[recovery operator authorization](../security/recovery-operator-authorization.md),
[service failure runbook](../operations/service-failure-runbook.md).

---

## 11. The disaster-recovery drill

Requires PostgreSQL 17 client tools on `PATH` and a valid
`DR_BACKUP_ENCRYPTION_KEY` (32 bytes, base64) — `pnpm env:init:local` generates
one for you.

### 11.1 Create an encrypted backup set

```powershell
pnpm dr:backup
```

It dumps all five service databases with `pg_dump --format custom --no-owner
--no-acl`, encrypts each with AES-256-GCM, checksums the **ciphertext**, records a
manifest, and publishes the set atomically: everything is written to a temporary
directory and renamed into place only once every dump has been taken, encrypted,
checksummed and listed. A failure removes the partial directory, so nobody ever
restores from a half-written set. Each plaintext dump is deleted in the same loop
iteration that produced it.

Redis is deliberately **not** in the backup scope. It holds recreatable cache,
replay and velocity state — not authoritative balances or credential records — so
backing it up would preserve nothing a restore could not rebuild while widening
what a stolen backup set exposes.

The command ends by printing the exact next commands with the new set named:

```text
Backup set created: backup:2026-08-01:1a2b3c4d

Next steps, in order:
  pnpm dr:backup:verify -- --set backup:2026-08-01:1a2b3c4d
  pnpm dr:backup:verify:negative -- --set backup:2026-08-01:1a2b3c4d
  pnpm dr:restore:verify -- --set backup:2026-08-01:1a2b3c4d
```

Show the set on disk. Five `.enc` files and a `manifest.json` under
`.dr-backups/backup_*/`. The first eight bytes of an encrypted file are the magic
`AEGISBK1`; everything after the header is ciphertext, and there is no plaintext
`PGDMP` header anywhere.

### 11.2 Naming the set is mandatory

A bare `pnpm dr:backup:verify` or `pnpm dr:restore:verify` **fails**:

```text
A backup set must be named explicitly.

  --set <backup-set-id>   operate on exactly this set
  --latest                operate on the newest set by manifest creation time

Refusing to guess: verifying or restoring a set the operator did not name is
how a drill ends up recording evidence about bytes it never examined.
```

`--latest` chooses by the manifest's `createdAt`, never by directory name — a set
directory ends in a random suffix, so a lexicographic sort picks the largest
random value rather than the newest set. Two sets sharing the newest timestamp is
an **error**, not a coin toss, because picking one arbitrarily would make the
drill's evidence depend on filesystem ordering.

### 11.3 Verify without restoring

```powershell
pnpm dr:backup:verify -- --set <backup-set-id>
```

It validates the manifest schema, that every listed file exists and is a regular
file, that every checksum matches the ciphertext, and that the configured key
authenticates every file. **Checksums are verified before anything is decrypted**,
so a corrupted set is rejected without the key ever touching it. Nothing is
written to disk and no database is touched.

### 11.4 Prove the refusals against a real set

```powershell
pnpm dr:backup:verify:negative -- --set <backup-set-id>
```

This is the part worth dwelling on. A backup set is attacker-influenced input the
moment it lives on shared storage. The script copies the real set nine times,
breaks each copy differently, and requires every one to be refused:

| Case                           | What is broken                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `wrong-key`                    | A different 32-byte key: GCM authentication fails rather than yielding plausible rubbish |
| `tampered-ciphertext`          | One bit of one encrypted file flipped                                                    |
| `missing-file`                 | A listed file deleted                                                                    |
| `incomplete-set`               | A service removed from both the manifest and the directory                               |
| `duplicate-service`            | The same service listed twice                                                            |
| `path-traversal-filename`      | A file name of `../escaped.dump.enc`                                                     |
| `unsupported-manifest-version` | Manifest version `9.9`                                                                   |
| `unsupported-algorithm`        | Algorithm changed to `AES-128-CBC`                                                       |
| `symlink-escape`               | A listed file replaced by a symlink pointing outside the set                             |

A pristine control copy is verified first — otherwise every refusal would be
meaningless. The original set is never modified; each case works on a copy in a
temporary directory that is removed afterwards. The script exits non-zero if any
case is **accepted**, which is the only dangerous outcome.

### 11.5 Restore into disposable databases

```powershell
pnpm dr:restore:verify -- --set <backup-set-id>
```

The safety property that matters most: **this can never write to a live service
database.** Every target is a freshly created database named
`aegis_verify_<service>_<12 random hex characters>`, the generated name is checked
against the live database names before a single byte is restored, and the name is
re-validated against `^[a-z0-9_]{1,63}$`. There is no flag, environment variable
or argument that redirects it — `--set` names which backup to **read**, never
where to write. Overwriting a live database is not a supported operation of this
tool.

Each restored database is then asserted to contain application tables in the `app`
schema, not merely to exist. Decrypted dumps are removed as soon as they are
consumed, and the disposable databases are dropped in a `finally` block, so a
failure mid-restore leaves neither plaintext nor half-restored databases behind. A
cleanup failure is itself reported rather than swallowed.

The output carries `measuredRecoveryPointAgeSeconds` and
`measuredRecoveryDurationMs`. Name them accurately when you present them:
**measured prototype recovery-point age** and **measured prototype recovery
duration**. They are not an RPO or an RTO.

### 11.6 The full drill

```powershell
pnpm dr:drill
```

Backup → register the set → verify → isolated restore → four reconciliations
(Ledger, Payments, Risk, Resilience) → `PASSED` → `CLEANED_UP`. Every step is
posted to the Resilience service as it happens, so the evidence lands in the
append-only drill history rather than only in a terminal. Each step names the set
the previous step produced, and the drill fails if any step reports a different
identifier — a drill that verified a different set would record evidence about
bytes it never examined.

The drill fails, loudly, when a dump is missing, a checksum differs, ciphertext is
tampered with, the key is wrong, a service is absent from the set, a reconciliation
fails, or cleanup fails. A recorded failure carries a failure code (`BACKUP_FAILED`,
`MANIFEST_INVALID`, `RESTORE_FAILED`, `RECONCILIATION_FAILED`) and appears in the
console for acknowledgement instead of vanishing.

Refresh `/security-ops/resilience` to see the new drill at the top of the history.

### 11.7 Reconciliation on its own

```powershell
pnpm reconcile:all
```

Runs the Ledger, Payments, Risk and Resilience reconciliations in sequence —
sequential on purpose, so a failure can be attributed — and prints one summary in
which only allow-listed counter fields are reproduced and every value is redacted
first. Requires the Risk and Resilience services to be running.

### 11.8 Clean up

```powershell
Remove-Item -Recurse -Force .dr-backups
```

A backup set is customer data under a key. Do not leave demonstration sets lying
around, and never commit one — `.dr-backups/`, `*.dump` and `*.dump.enc` are all
git-ignored.

Related: [backup and restore runbook](../operations/backup-restore-runbook.md),
[disaster recovery runbook](../operations/disaster-recovery-runbook.md),
[backup encryption and key management](../security/backup-encryption-and-key-management.md),
[backup retention and disposal](../security/backup-retention-and-disposal.md),
[disaster recovery demo](../demo/disaster-recovery-demo.md).

---

## 12. Stopping and resetting

**Stop the services**: press `Ctrl+C` in the `demo:start` terminal. Children are
stopped in reverse start order and each one is waited for, because a child that
outlives the parent keeps its port bound and makes the next start fail
confusingly. It prints `[demo] local data was not touched`.

**Stop the containers, keep the data:**

```powershell
pnpm demo:stop
```

This runs `infra:down`, which stops and removes the containers but preserves the
named volumes `aegis-postgres-data` and `aegis-redis-data`. Your accounts,
journals, events and drill history survive. Run `pnpm demo:start` again and you are
back where you were.

**Destroy the local data:**

```powershell
pnpm demo:reset -- --yes
```

The `--yes` is mandatory. Without it the command refuses:

```text
[demo] Refusing to destroy local data without explicit confirmation. Re-run: pnpm demo:reset -- --yes
```

With it, the volumes are verified to belong to this project, destroyed, and the
infrastructure is brought back up empty. You will need `pnpm db:deploy` again —
`pnpm demo:start` does that for you.

If you also created backup sets, delete `.dr-backups/` separately. Reset does not
touch it, deliberately: destroying a backup set is a different decision from
destroying a database.

---

## 13. Troubleshooting

### The Docker engine is not running

```text
[demo] the Docker engine is not available. Start Docker and retry.
```

`docker version` may still report a client while the server is down. Check with
`docker info` — that requires a live engine. On Windows, Docker Desktop must have
finished starting its Linux engine, not merely have a window open. Everything that
does not need Docker (`pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`,
unit tests, tooling tests, contract tests, web component tests) still runs.

### A port is already in use

`pnpm env:check` catches the configuration form of this — two services claiming
the same port is reported as `uses the same port as <OTHER_VARIABLE>`. A port held
by an unrelated process shows up differently: the service starts, never answers
its health endpoint, and `demo:start` reports
`<service> exited during startup.` or `<service> did not become ready in time.`
before shutting down what it had started.

Find the offender and stop it:

```powershell
Get-NetTCPConnection -LocalPort 4000 -State Listen | Select-Object OwningProcess
Get-Process -Id <pid>
```

The usual cause is an earlier run that was killed rather than stopped. `pnpm demo:status`
tells you which ports are answering.

### A stale or incomplete `.env`

Symptoms: `[env] configuration is incomplete; no values were displayed`, a service
that starts and immediately exits, or a login role that cannot connect after you
changed a password by hand.

Run `pnpm env:check` and read the variable names it lists. The most common cause
is editing a password without editing the matching `*_DATABASE_URL` — which is why
`env:check` cross-checks that each URL names the database and role its `*_DB_NAME`
and `*_DB_USER` variables declare.

To start clean:

```powershell
pnpm env:init:local -- --force
pnpm env:check
pnpm demo:reset -- --yes
```

The old file is kept as `.env.replaced`. Note that regenerating secrets while an
old database volume still exists leaves roles with the old passwords, which is why
the reset belongs in that sequence.

### `pg_dump` is missing or is not version 17

Symptoms: `pnpm dr:backup` fails immediately, or reports a server-version mismatch.

```powershell
pg_dump --version
```

If the command is not found, the client tools are not on `PATH`. If it reports 15
or 16, an older client is shadowing the newer one — on Windows this is usually an
old PostgreSQL installation earlier in `PATH`. Install the version 17 client tools
and put them ahead of the older ones. Every other part of the demonstration works
without them; only [section 11](#11-the-disaster-recovery-drill) needs them.

### SABCL strict mode without keys

Symptoms: `env:check` reports
`SABCL_GATEWAY_ENCRYPTION_PRIVATE_KEY — is still a placeholder; run pnpm sabcl:keys`,
or the router refuses to start.

This is correct behaviour, not a bug. Strict mode refuses placeholder key
material, test fixtures, missing keys and missing routes **at startup**, and there
is no automatic downgrade from strict — a router outage in strict mode is an
outage, never a plaintext retry. Either generate real keys as described in
[section 8](#8-sabcl-what-an-observer-sees), or set `SABCL_MODE=off` and
demonstrate the rest of the platform. `off` is the shipped default precisely so
this cannot block a demonstration.

`compatible` mode allows a documented fallback to the direct internal path and is
refused when `NODE_ENV=production`.

### Browser test ports occupied

`pnpm web:test:e2e` and `pnpm web:test:a11y` start their own stack and require
ports **3000, 4000, 4101, 4102, 4104, 4105 and 4106** to be free. If one is taken
they fail before launching a browser:

```text
Required test port 4000 is already in use.
```

Stop `pnpm demo:start` first — the browser suites are not meant to share a machine
with a running demonstration stack. They also assert every port is released after
cleanup and report `Port <n> remained in use after browser cleanup.` if not.

Install the browser once before the first run:

```powershell
pnpm web:e2e:install
```

### Screenshots

```powershell
pnpm demo:evidence
```

Requires a running stack (`pnpm demo:start` in another terminal) and the Playwright
Chromium install above. It captures public and synthetic pages only, at desktop
(1440×900) and mobile (390×844), into the git-ignored `.evidence/`. It scans each
captured page's text for one-time codes, PINs, cookies, tokens, connection strings,
full account references and private keys, and refuses to finish if it finds any.
It prints a manual-review notice regardless: an image can show something a text
scan cannot see. It never commits and never uploads.

---

## 14. Prototype limitations

State these plainly. A judge trusts a team that draws its own boundary more than
one that has to be pushed to it.

**AEGIS Shield is a hackathon prototype, not a production banking system.** It does
not provide:

- production multi-region disaster recovery;
- continuous replication;
- zero data loss;
- compliance certification of any kind;
- a guaranteed production recovery-point objective or recovery-time objective;
- protection against the loss of a cloud region or a cloud provider;
- a trained fraud model — risk scoring is deterministic integer-weight rules;
- production workforce identity — the operator console uses a development-only
  bootstrap token that is refused when `NODE_ENV=production`;
- external payment rails — no money leaves this machine;
- production messaging — one-time codes are displayed locally because
  `DEMO_AUTH_ENABLED` is true, and that flag is refused in production.

Additional boundaries worth saying out loud:

- **Recovery figures are measurements, not objectives.** The console shows a
  _measured prototype recovery-point age_ and a _measured prototype recovery
  duration_ from a drill against local disposable infrastructure.
- **SABCL padding hides size within a bucket only.** Timing and traffic volume are
  not hidden, forward secrecy is one-sided, and nothing protects a payload after
  the recipient decrypts it.
- **The SABCL status page is a status view, not a security control.**
- **Redis is not backed up.** Its cache, replay and velocity state is recreatable
  by design.
- **Use synthetic data only.** Never real money, never real credentials, never a
  real customer record.

### Verification status

Use only these labels, and use them accurately:

| Check                                                                                           | Status                               |
| ----------------------------------------------------------------------------------------------- | ------------------------------------ |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`                                | PASS LOCALLY                         |
| Unit tests, tooling tests, contract tests, web component tests                                  | PASS LOCALLY                         |
| Migrations, integration tests, end-to-end tests, Playwright functional and accessibility suites | PASS IN CI                           |
| Backup, negative backup, isolated restore, DR drill, four reconciliations                       | PASS IN CI                           |
| Anything requiring a Docker engine, on the development machine                                  | NOT RUN LOCALLY — Docker unavailable |

The development machine has no working Docker engine: `docker version` reports the
client, but the server returns `request returned 500 Internal Server Error for API
route and version http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.55/version`.
Docker-dependent acceptance is therefore performed by GitHub Actions and is
authoritative there. **No owner-machine clean-room claim is made.**

CI runs exactly four jobs — `lint`, `typecheck`, `test`, `build`. The `test` job
runs real PostgreSQL 17 and Redis in Docker, installs the PostgreSQL 17 client
tools, applies all five committed migration sets, and then runs unit, integration,
end-to-end, Playwright functional, Playwright accessibility, backup, negative
backup, isolated restore, DR drill, four reconciliations and cleanup. It asserts
afterwards that no decrypted dump and no disaster-recovery working directory
survived the job. CI never uploads dumps, decrypted files, `.env`, tokens or keys.

The other release documents in this directory — `RELEASE_NOTES.md`,
`SUBMISSION_CHECKLIST.md`, `FINAL_VALIDATION_REPORT.md`,
`final-capability-audit.md` and `final-security-review.md` — carry the detailed
audit results.

---

## 15. Presentation script

Six minutes, as speaker notes. Timings are cumulative and add to 6:00. Have the
stack already running and already signed in as a customer, with a second browser
window on `/security-ops` and a terminal ready. Rehearse the transitions; they are
where time is lost.

---

**0:00 – 0:30 — The problem (30 s)**

> Digital banking has to stay correct and available while under attack, and it has
> to reach people who do not have a smartphone or a branch nearby. Perimeter
> security does not cover internal traffic. Encrypting a link does not hide who is
> paying whom from the middlebox that terminates it. And a backup nobody has ever
> restored is not a recovery plan.
>
> AEGIS Shield is a prototype that takes those three problems seriously. Six
> independent services, five databases with a least-privilege role each, and one
> browser-facing gateway.

_On screen: `/app`, already signed in._

---

**0:30 – 1:15 — Identity and the customer (45 s)**

> This customer onboarded with a phone number and a six-digit PIN, then added a
> passkey. The biometric never left the device. The session is an opaque revocable
> value in Redis behind an HttpOnly cookie, with a readable CSRF cookie the browser
> echoes in a header.
>
> Everything on this page is masked. Money is integer minor units end to end —
> `BIGINT` in the database, `BigInt` in code, decimal strings on the wire. No
> floating point touches money anywhere in this system.

_Switch the language to Sinhala, then to Tamil. Let the page re-render on camera —
that is the inclusion point, and it costs three seconds._

---

**1:15 – 2:00 — A transfer, and why it is hard to abuse (45 s)**

> Preview first. That returns a short-lived intent — nothing has moved, and the
> authorisation expires in five minutes.
>
> Confirming asks for the PIN again, and the gateway does not check it: it asks the
> Identity service, which is the only service that owns credentials. Watch a wrong
> PIN — generic message, counted attempt, and a security event is already on its
> way to the Risk service.
>
> Now the right PIN. The browser generated one idempotency key and reuses it for
> every retry. Confirming twice gives you the same transfer, not two. Payments
> orchestrates; the Ledger is the only balance authority, and the database refuses
> to commit an unbalanced journal.

_Show `/app/transfers/<id>` and the printable receipt._

---

**2:00 – 2:40 — Reaching everyone (40 s)**

> Three inclusive channels, all on the same ledger and the same rules.
>
> QR Pay: the payload is signed with HMAC-SHA-256 over a canonical serialisation.
> Flip one character and the signature check fails. Dynamic codes expire in five
> minutes, static ones carry no amount. Redeeming the same code twice is recognised
> as a replay and returns the original result rather than settling again.
>
> USSD for a feature phone — `*123#`, bounded session state in Redis that expires
> in five minutes on its own.
>
> Agent cash for someone with no phone at all: per-agent daily limits, PIN
> authorisation, and the same idempotency requirement as a transfer.

_Click through `/app/channels/qr`, then `/app/channels/ussd`. Do not linger._

---

**2:40 – 3:30 — SABCL, the signature idea (50 s)**

> This is the part I would like you to remember. Internal calls are sealed before
> they leave the sending process: X25519 to the recipient's key, HKDF-SHA-256,
> AES-256-GCM, Ed25519 signature. They then pass through a router that decides
> where they go — and that router holds **no key that opens them**.
>
> Here is everything the router sees: a version, a random message id, an opaque
> route token, key identifiers, a nonce, a hop count, a size bucket and ciphertext.
> No path. No customer. No amount.
>
> The route token is an HMAC of a **capability name**, not a URL, so there is no
> request shape that names a destination. And this test proves it: it seeds marked
> values in every sensitive category and asserts none appears in the envelope as
> raw text, base64, hex or percent-encoding.
>
> What it does not do: padding hides size within a bucket, and nothing more.

_On screen: `/app/sabcl`, then the router log line, then `pnpm sabcl:test:leakage`
passing._

---

**3:30 – 4:20 — Detection and containment (50 s)**

> Those failed PIN attempts are already here. Scoring is deterministic integer
> weights, capped at 100, banded LOW through CRITICAL. No model, no training data,
> no randomness — the same events always produce the same decision, and the
> triggered rules and reason codes are stored with the assessment, so the
> explanation survives.
>
> This one crossed the threshold and produced a **scoped, expiring control** plus
> an incident. Retrying the transfer is now refused with a generic message that
> tells an attacker nothing.
>
> The important part: that control is enforced independently at the gateway, in
> Payments and in Identity. It is not a flag the UI honours.
>
> I release it — and the console demands an audited reason before it will.

_On screen: `/security-ops`, the incident, then the release prompt._

---

**4:20 – 5:20 — Recovery you can prove (60 s)**

> A backup you have never restored is a hope, not a plan. So we drill.
>
> `pnpm dr:drill`. Encrypted backup of all five databases, AES-256-GCM.
> Verification checks checksums **before** anything is decrypted, so a corrupted
> set is rejected without the key ever touching it. Then a restore — into freshly
> generated disposable databases whose names are checked against the live ones
> first, and dropped afterwards in a `finally`. Then four reconciliations. Then the
> evidence.
>
> And these refusals run against a real set, not a synthetic one: wrong key,
> flipped bit, missing file, duplicate service, a path in a filename, a symlink out
> of the directory. Nine cases, all refused. A backup set is attacker-influenced
> input the moment it is on shared storage.
>
> The console shows the result — and notice what is missing: no button that runs a
> restore. That is CLI tooling, because a console button that shells out is remote
> command execution with a nicer label. Try to rewrite the drill history in `psql`
> and PostgreSQL raises `resilience drill history is append-only`.

_On screen: the drill output, then `/security-ops/resilience`._

---

**5:20 – 5:50 — What this is not (30 s)**

> Boundaries, honestly. This is a prototype. There is no multi-region disaster
> recovery, no continuous replication, no zero data loss, no compliance
> certification, no guaranteed production recovery objective. The numbers on that
> console are a **measured prototype recovery-point age** and a **measured
> prototype recovery duration** from a drill against local disposable
> infrastructure — not an RPO and not an RTO.
>
> There is no trained fraud model, no production workforce identity, no external
> payment rail and no production messaging. Every piece of data you have seen is
> synthetic.
>
> Docker-dependent acceptance runs in GitHub Actions and is authoritative there.
> We do not claim a clean-room run on our own machine, because we did not have one.

---

**5:50 – 6:00 — Close (10 s)**

> Zero-trust between services, resilience you can measure, inclusion that reaches a
> feature phone — and a metadata layer that lets a router route without reading.
> One command starts all of it. Thank you.

---

### If you have seven minutes

Add sixty seconds and spend it here, in this order of value:

1. **+25 s** — the passkey ceremony live at `/app/security`. It is the most
   visceral thirty seconds in the demonstration.
2. **+20 s** — stop the Risk service, refresh `/security-ops/resilience`, show
   `DEGRADED` and `UNAVAILABLE`, restart it, refresh: `HEALTHY` on the very next
   call with no cached verdict to clear.
3. **+15 s** — `pnpm env:check` on the projector, and point out that a validator
   which printed values would put a password into the recording.

### If something breaks on stage

Do not debug in front of the judges. Say what the guard did and why it is correct —
most failures in this system are refusals, and a refusal is a feature. Then move to
the next section. `pnpm demo:status` in your second terminal will tell you in two
seconds whether you have lost a service or lost a network.
