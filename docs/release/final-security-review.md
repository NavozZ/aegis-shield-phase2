# AEGIS Shield — Final Security Review

This is the closing security review of the AEGIS Shield prototype for Duothan 6.0
Phase 2. It is written for a reader who will not run the code: every claim below
names the file that supports it, and every claim the code does not support is
recorded as a residual risk rather than omitted.

AEGIS Shield is a **prototype**. It is not a production banking system, it holds
no real money, and nothing in this document should be read as a compliance
assertion. The [Deferred production controls](#deferred-production-controls)
section at the end is not an afterthought; it is the half of the picture that
makes the rest of the document honest.

---

## Release blockers

Six confirmed defects in the inclusive-channel code make this repository unsafe
to submit as a working demonstration of the USSD and agent-cash channels. They
are listed here, before anything else, because a reader who stops after the
summary table must still see them.

Each was verified by reading the source, not inferred. None is fixed: the
decision for this release was to document them rather than change the channel
service code at the final step. **The USSD and agent-cash channels must not be
demonstrated as working, and the deployment must not be exposed to any network.**

| #   | Blocker                                                                                                                                                                                                                               | Evidence                                                                                                                | Effect                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| B-1 | `POST /api/v1/channels/ussd/webhook` has no session, no CSRF and no provider authentication. Its code comment claims "MSISDN auth is done by Payments/Identity"; Payments authenticates nothing.                                      | `apps/api-gateway/src/channels/channels.controller.ts` (`ussdWebhook`); `services/payments/src/ussd/ussd.controller.ts` | An anonymous caller reaches a money-movement state machine                                                         |
| B-2 | `USSD_PROVIDER_SECRET` is declared in `.env.example`, required by `pnpm env:check`, and read by no service source file.                                                                                                               | `infra/scripts/env.mjs`; absent from `services/payments/src/common/config/payments.config.ts`                           | The intended webhook control was never wired                                                                       |
| B-3 | The only authorization before `ledger.transfer()` on the USSD path is a comparison against the string literal `'123456'`.                                                                                                             | `services/payments/src/ussd/ussd.service.ts` (`SEND_MONEY_PIN`)                                                         | A published constant authorises a transfer                                                                         |
| B-4 | With no customer supplied — which is every unauthenticated webhook call — the service substitutes `'00000000-0000-0000-0000-000000000000'` and uses it as both `senderCustomerId` and `sourceAccountId`. The code labels this "Hack". | `services/payments/src/ussd/ussd.service.ts`                                                                            | Transfers are attributed to a fabricated identity                                                                  |
| B-5 | USSD amounts are parsed with `Math.floor(parseFloat(userInput) * 100)`.                                                                                                                                                               | `services/payments/src/ussd/ussd.service.ts`                                                                            | IEEE-754 rounding on money: `parseFloat('1.15') * 100` floors to **114**, not 115                                  |
| B-6 | Agent cash takes `agentId` from the ordinary customer session with no agent-role check, and records a hardcoded `agentReference: 'AEGIS-AGT-0000'`.                                                                                   | `apps/api-gateway/src/channels/channels.controller.ts` (`agentCashInPreview`, `agentCashIn`, `agentCashOut`)            | Any signed-in retail customer can perform teller operations, and every agent record names the same fictional agent |

Two further findings of the same class are recorded below rather than here
because they need a valid intent token to exploit: QR `confirm()` and agent
`confirm()` both resolve an operation by intent-token hash without checking that
the caller owns it (`services/payments/src/qr/qr.service.ts`,
`services/payments/src/agent/agent.service.ts`).

### What this means for the two section-7 checks they touch

- **"CSRF remains enabled"** — true for every browser route except B-1, which has
  neither CSRF nor a session. Recorded as **FAILED** rather than CONFIRMED.
- **"Monetary values use integer minor units"** — true throughout the Ledger,
  Payments transfers, QR and agent cash, and false on the USSD amount path (B-5).
  Recorded as **PARTIAL**.

Neither check can be reported as passing while B-1 and B-5 stand.

---

## Scope

### In scope

| Area                  | What was reviewed                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Repository hygiene    | Tracked files and full git history, `.gitignore`, `.env.example`, CI workflow                                                   |
| Public HTTP surface   | API Gateway on 4000 — cookies, CSRF, CORS, rate limiting, validation, error shaping                                             |
| Internal HTTP surface | Identity 4101, Ledger 4102, SABCL router 4103, Payments 4104, Risk 4105, Resilience 4106 — authentication, binding, body limits |
| Credentials           | OTP challenge handling, PIN storage and verification, session issuance and revocation, service-to-service tokens                |
| Money handling        | Minor-unit representation across the Ledger, Payments and the inclusive channels                                                |
| Data at rest          | PostgreSQL role and schema grants, append-only triggers, encrypted disaster-recovery backup sets                                |
| Operator surfaces     | `/security-ops` and `/security-ops/resilience`, and the Risk-owned operator session they both depend on                         |
| Recovery tooling      | `pnpm dr:backup`, `pnpm dr:backup:verify`, `pnpm dr:backup:verify:negative`, `pnpm dr:restore:verify`, `pnpm dr:drill`          |
| Logging and telemetry | Request logs, exception filters, the Risk security-event attribute allowlist, evidence-capture sanitization                     |
| Supply chain          | `pnpm audit --prod` against the committed lockfile                                                                              |

### Out of scope

Anything the prototype does not have cannot be reviewed. There is no production
deployment, no cloud account, no TLS terminator, no workforce identity provider,
no external payment rail, no secret-management service and no monitoring
pipeline, so none of those were assessed. There is also no penetration test and
no third-party review: this is a first-party code review supported by the
repository's own automated suites.

The development machine used for this review has **no working Docker engine** —
`docker version` reports the client, and the server returns
`request returned 500 Internal Server Error for API route and version http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.55/version`.
Every check below was therefore performed by reading the repository and by
running the Docker-independent tooling locally. The Docker-dependent
acceptance — real PostgreSQL 17 and Redis, migrations, integration and end-to-end
suites, backup, negative backup, isolated restore and the disaster-recovery
drill — is authoritative in **GitHub Actions**, not on this machine. No
owner-machine clean-room claim is made anywhere in this document.

---

## Method

Five techniques, applied in this order.

1. **Repository enumeration.** `git ls-files` was read in full (613 tracked
   files) and the entire history was searched for files that must never be
   committed: `.env`, PEM and key material, `*.dump`, `*.dump.enc` and backup
   directories. History was searched with `git log --all --diff-filter=A` so a
   file that was added and later deleted would still be found.
2. **Control-by-control source reading.** For each item in the findings table,
   the file that implements the control was read end to end rather than grepped.
   Where a control is an _absence_ — no shell endpoint, no plaintext fallback —
   the absence was verified by searching for the thing that must not exist
   (`child_process`, `spawn`, fallback branches) across `apps/`, `services/` and
   `packages/`.
3. **Negative-path confirmation.** Several controls are asserted by tests that
   deliberately break something and require a refusal. Those tests were read to
   confirm the assertion is a refusal and not merely an absence of a crash — for
   example `services/resilience/scripts/backup-negative.mjs`, which mutates a
   real backup set nine ways and fails the run if any mutation is accepted.
4. **Configuration-boundary reading.** Each service's configuration loader was
   read for its production refusals, because most of the prototype's
   "development is permitted, production is not" behaviour lives there rather
   than in request handling.
5. **Supply-chain check.** `pnpm audit --prod` was run against the committed
   `pnpm-lock.yaml`.

Status vocabulary used throughout, and nowhere stretched:

- **PASS LOCALLY** — run on this machine, Docker not required.
- **PASS IN CI** — run by GitHub Actions, which is authoritative for anything
  needing PostgreSQL, Redis or a browser.
- **NOT RUN LOCALLY — Docker unavailable.**
- **FAIL**, **BLOCKED** — neither applies to anything in this review.

Disposition vocabulary in the findings table:

- **CONFIRMED** — the control exists in the code and behaves as described.
- **RESIDUAL RISK** — a real gap, weakness or accepted trade-off that a reader
  must know about.
- **NOT APPLICABLE** — the control does not apply to this design, with the
  reason given.

---

## Findings

Thirty-nine findings across eight areas. Thirty-one are confirmed controls, seven
are residual risks, and one is not applicable. Every residual risk is expanded in
the per-area detail that follows the tables — none of them is left as a table row.

### Repository and supply chain

| #    | Control                                                                       | Evidence                                                                                                                                                                        | Disposition |
| ---- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| R-01 | No tracked `.env`, and none in history                                        | `.gitignore` (`.env`, `.env.*`, `!.env.example`); `git ls-files` lists `.env.example` only                                                                                      | CONFIRMED   |
| R-02 | No committed secrets; every credential-shaped value is a labelled placeholder | `.env.example`; no PEM private-key block in any tracked file — the only `BEGIN … PRIVATE KEY` string in the repository is the detection pattern in `infra/scripts/evidence.mjs` | CONFIRMED   |
| R-03 | No tracked database dumps                                                     | `.gitignore` (`*.dump`, `*.dump.enc`, `.dr-backups/`); no `.dump` in `git ls-files` or history                                                                                  | CONFIRMED   |
| R-04 | No decrypted backup material survives a run                                   | `services/resilience/scripts/restore-verify.mjs` (`rmSync` in `finally`); `.github/workflows/ci.yml` assertion                                                                  | CONFIRMED   |
| R-05 | Production dependencies carry no known vulnerabilities                        | `pnpm audit --prod` → `No known vulnerabilities found`                                                                                                                          | CONFIRMED   |

### Authentication and credentials

| #    | Control                                                                         | Evidence                                                                                                                         | Disposition   |
| ---- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| A-01 | One-time codes are stored and compared as keyed digests, never in plaintext     | `services/identity/src/auth/otp/otp.service.ts`                                                                                  | CONFIRMED     |
| A-02 | PINs are Argon2id hashes; a miss still performs a dummy verification            | `services/identity/src/auth/pin/pin.service.ts`                                                                                  | CONFIRMED     |
| A-03 | No OTP, PIN or session identifier reaches any log line                          | `apps/api-gateway/src/common/http/correlation.middleware.ts`; `services/identity/src/common/http/structured-exception.filter.ts` | CONFIRMED     |
| A-04 | The one-time code **is** returned in a response when `DEMO_AUTH_ENABLED=true`   | `services/identity/src/auth/otp/otp.provider.ts`; `.env.example` ships `DEMO_AUTH_ENABLED=true`                                  | RESIDUAL RISK |
| A-05 | Session identifiers are opaque random bytes, stored in Redis under their digest | `services/identity/src/auth/sessions/session.service.ts`                                                                         | CONFIRMED     |

### Service-to-service authorization

| #    | Control                                                                                  | Evidence                                                                                            | Disposition |
| ---- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------- |
| T-01 | Risk event ingestion binds a source-specific token to the declared source                | `services/risk/src/events/event.service.ts`; `services/risk/src/common/config/risk.config.ts`       | CONFIRMED   |
| T-02 | Resilience accepts a source token and refuses an unknown source rather than falling back | `services/resilience/src/common/security/internal-token.guard.ts`                                   | CONFIRMED   |
| T-03 | Every internal token comparison is constant-time                                         | `services/*/src/common/security/security.ts` (`timingSafeStringEqual`)                              | CONFIRMED   |
| T-04 | Operator routes accept only a security-operator session, never a customer session        | `apps/api-gateway/src/operators/operators.controller.ts`; `.../resilience/resilience.controller.ts` | CONFIRMED   |

### Browser-facing gateway

| #    | Control                                                                                     | Evidence                                                                      | Disposition     |
| ---- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------- |
| G-01 | CORS is pinned to a single origin with an explicit method list                              | `apps/api-gateway/src/app.setup.ts`; `.../constants/application.constants.ts` | CONFIRMED       |
| G-02 | The six non-Gateway services register no CORS middleware at all                             | `services/*/src/app.setup.ts`                                                 | NOT APPLICABLE  |
| G-03 | Double-submit CSRF is enforced on state-changing routes with a constant-time comparison     | `apps/api-gateway/src/common/http/csrf.ts`                                    | CONFIRMED       |
| G-04 | Session cookie is `HttpOnly`; both cookies are `SameSite=Lax` and `Secure` in production    | `apps/api-gateway/src/auth/cookies.ts`                                        | CONFIRMED       |
| G-05 | Rate-limit buckets come from a fixed allowlist, so a path cannot mint fresh budget          | `apps/api-gateway/src/common/http/rate-limit-buckets.ts`                      | CONFIRMED       |
| G-06 | `/api/v1/channels/*` is **not** covered by the rate-limit middleware                        | `apps/api-gateway/src/app.module.ts` (`forRoutes`)                            | RESIDUAL RISK   |
| G-07 | `POST /api/v1/channels/ussd/webhook` requires no session, no CSRF and no provider signature | `apps/api-gateway/src/channels/channels.controller.ts`                        | **BLOCKER B-1** |

### Inclusive channels

| #    | Control                                                                                    | Evidence                                                                                           | Disposition     |
| ---- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | --------------- |
| C-01 | QR payloads are HMAC-SHA-256 signed over a canonical string, with a nonce and an expiry    | `services/payments/src/qr/qr-crypto.ts`                                                            | CONFIRMED       |
| C-02 | The USSD telco webhook compares the PIN against a hard-coded literal                       | `services/payments/src/ussd/ussd.service.ts`                                                       | RESIDUAL RISK   |
| C-03 | `USSD_PROVIDER_SECRET` is required by `pnpm env:check` but is never read by any service    | `infra/scripts/env.mjs`; absent from `.../payments.config.ts`                                      | **BLOCKER B-2** |
| C-04 | QR redemption, agent cash and the USSD webhook do not call the Payments risk-control check | `services/payments/src/qr/qr.service.ts`; `.../agent/agent.service.ts`; `.../ussd/ussd.service.ts` | RESIDUAL RISK   |

### Money and the ledger

| #    | Control                                                                                                                           | Evidence                                                                                       | Disposition               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------- |
| M-01 | Monetary values are integer minor units in the Ledger, Payments transfers, QR and agent cash — `BIGINT`, `BigInt`, decimal string | `services/ledger/src/money/money.ts`; `services/payments/src/common/config/payments.config.ts` | PARTIAL — see blocker B-5 |
| M-02 | The USSD amount step parses a decimal through a JavaScript float                                                                  | `services/payments/src/ussd/ussd.service.ts`                                                   | RESIDUAL RISK             |
| M-03 | The Ledger is the sole balance authority and binds an account to its owner                                                        | `services/ledger/src/transfers/customer-transfer.service.ts`                                   | CONFIRMED                 |
| M-04 | Journals, postings and the audit trails are append-only at the database level                                                     | `services/{ledger,payments,risk,resilience}/prisma/migrations/*/migration.sql`                 | CONFIRMED                 |

### Data at rest and recovery tooling

| #    | Control                                                                                        | Evidence                                                                                           | Disposition |
| ---- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------- |
| D-01 | Five databases, one non-superuser login role each, `PUBLIC` revoked                            | `infra/docker/postgres/init/01-create-service-databases.sh`                                        | CONFIRMED   |
| D-02 | Docker publishes PostgreSQL and Redis on `127.0.0.1` only                                      | `docker-compose.yml`                                                                               | CONFIRMED   |
| D-03 | No HTTP endpoint anywhere runs a shell command                                                 | No `child_process` import in any `src/` tree; `services/resilience/src/drills/drill.controller.ts` | CONFIRMED   |
| D-04 | A backup set names files, never paths; traversal and symlinks are refused                      | `services/resilience/scripts/dr-lib.mjs` (`assertSafeFileName`, `assertRegularFile`)               | CONFIRMED   |
| D-05 | A restore target is always a freshly generated disposable database, checked against live names | `services/resilience/scripts/restore-verify.mjs`                                                   | CONFIRMED   |
| D-06 | Checksums are verified against ciphertext **before** the key is applied                        | `services/resilience/scripts/dr-lib.mjs`; `packages/contracts/src/resilience/backup-crypto.ts`     | CONFIRMED   |

### SABCL and telemetry

| #    | Control                                                                              | Evidence                                                                                                   | Disposition |
| ---- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------- |
| S-01 | Strict mode never falls back to a plaintext internal call                            | `packages/sabcl/src/config/environment.ts`; `apps/api-gateway/src/accounts/ledger.client.ts`               | CONFIRMED   |
| S-02 | `SABCL_MODE=compatible` is refused when `NODE_ENV=production`                        | `packages/sabcl/src/config/environment.ts`; `infra/scripts/env.mjs`                                        | CONFIRMED   |
| S-03 | Demo authentication and the operator bootstrap token are refused in production       | `services/identity/src/common/config/identity.config.ts`; `services/risk/src/common/config/risk.config.ts` | CONFIRMED   |
| S-04 | Security events carry only allowlisted attributes, so a credential cannot ride along | `packages/contracts/src/risk/v1.ts`                                                                        | CONFIRMED   |

---

## Per-area detail

### Repository and supply chain

The `.gitignore` treats secrets, recovery material and evidence as three separate
problems and solves each explicitly. `.env` and `.env.*` are ignored with a single
`!.env.example` exception; `*.pem`, `*.key`, `*.p12` and `certs/local/` are ignored
so a locally generated key cannot be staged by a wildcard `git add`; `.dr-backups/`,
`*.dump` and `*.dump.enc` are ignored with a comment explaining why — a backup set
is the entire platform's contents under one key, and committing one would put it
in history permanently. `.evidence/` is ignored because screenshots await manual
review before anyone shares them.

The history search matters more than the working-tree search. `git ls-files`
tells you what is tracked _now_; a secret that was committed on Monday and
deleted on Tuesday is still in the pack files. Searching added files across all
refs returned nothing for `.env`, `*.pem`, `*.key`, `*.dump` or `*.enc`.

Every credential-shaped value in `.env.example` is a self-describing placeholder:
`local-only-…-change-me`, `example-only-not-a-secret`, or
`BASE64_LOCAL_ONLY_…_PLACEHOLDER`. That naming is load-bearing rather than
cosmetic — six configuration loaders (Gateway, Identity, Ledger, Payments, Risk
and Resilience) test their secrets against a placeholder pattern built from
`change-me`, `local-only`, `placeholder` and, in most of them, `example-only`,
and refuse to start in production if any of those survives. The CI workflow uses the same convention
(`ci-only-…`), and its one real key, `DR_BACKUP_ENCRYPTION_KEY`, is documented
in the workflow as the base64 of an obviously non-secret ASCII string, chosen so
the genuine AES-256-GCM path is exercised without a secret being present.

`pnpm audit --prod` reported **"No known vulnerabilities found"** against the
committed lockfile. Major dependency upgrades were deliberately **not**
undertaken for this final release. Next 16, NestJS, Prisma and Playwright are all
on versions the whole suite is green against; a major bump on the last day
before submission would trade a known-good state for an unmeasured one, and the
audit gives no reason to take that trade. The correct next step is a scheduled
upgrade with the full suite green, not a release-eve change.

### Authentication and credentials

A one-time code exists in plaintext only inside the request that generates it.
`OtpService.request` produces a six-digit code with `randomInt`, immediately
derives `keyedDigest(code, internalToken)`, and stores only that digest in Redis
under a TTL. Verification recomputes the digest and compares with
`timingSafeStringEqual`. There is no code path that reads a stored code back,
because none is stored. Failed attempts increment a counter inside the stored
challenge and the challenge is deleted once `OTP_MAX_ATTEMPTS` is reached, so the
digest cannot be attacked indefinitely.

PINs use Argon2id with `memoryCost: 19456`, `timeCost: 2`, `parallelism: 1`. The
service keeps a dummy hash generated at module init and exposes
`performDummyVerification`, so a sign-in attempt against a customer who has no
PIN still costs an Argon2id verification. Without that, response timing would
tell an attacker which phone numbers are enrolled.

Logging was checked line by line rather than assumed. The gateway and Identity
request loggers emit exactly five fields — correlation id, method, path, status
code and duration — and nothing else. Neither logs a header, a cookie or a body.
The exception filters are stricter still: `GatewayExceptionFilter` returns a code
and a fixed message and never serialises the exception, and Identity's
`StructuredExceptionFilter` logs only the exception's constructor name plus an
error code that must match `/^[A-Z0-9_-]{1,32}$/` before it is included — so a
driver that puts a connection string in `error.code` cannot leak it through the
log.

**A-04 — residual risk.** `DemoOtpProvider.exposeForDemo` returns the code, and
the onboarding and sign-in responses carry it as `demoOtp` when
`DEMO_AUTH_ENABLED=true`. The web UI renders it inside a `PrototypeWarning`
panel. This is a deliberate affordance: there is no SMS provider, so without it
nobody can complete a journey. It is fenced three ways — Identity throws at
startup if `demoAuthEnabled` is true and `NODE_ENV=production`
(`validateProductionSecrets`), `pnpm env:check` reports it as a problem under
production, and `DisabledOtpProvider` returns `undefined` otherwise. The residual
risk is that `.env.example` ships `DEMO_AUTH_ENABLED=true`, so the default local
posture is the permissive one, and a deployment that never sets `NODE_ENV` at all
keeps it. Accepted for a prototype whose entire dataset is synthetic; it would be
unacceptable with any real user.

Sessions are opaque random bytes. `SessionService` keys Redis on
`sha256(sessionId)` and stores a CSRF **hash**, not the token, so a Redis dump
yields neither a usable session cookie nor a usable CSRF token. Revocation is a
push: the Risk service calls Identity's `/internal/v1/sessions/revoke` when an
automated control fires (`services/risk/src/controls/identity-control.client.ts`),
and Identity records the revocation as an auth event.

### Service-to-service authorization

The prototype does not have one shared internal password. It has a per-service
internal token **plus** per-source tokens where the source matters.

Risk ingestion is the clearest case. `EventController.ingest` is marked
`@PublicRoute()`, which exempts it from the internal-token guard — deliberately,
because `RISK_INTERNAL_TOKEN` must _not_ be able to write security events. Instead
`EventService.authenticate` looks up `sourceTokens[event.source]` and compares it
with the supplied `x-aegis-source-token` in constant time. There are six source
tokens (`GATEWAY`, `IDENTITY`, `PAYMENTS`, `LEDGER`, `INFRASTRUCTURE`,
`CHANNEL_ADAPTER`), each required at startup. The consequence is precise: a
compromised Payments service cannot forge an event claiming `source: 'IDENTITY'`,
because the token it holds is bound to the source it may declare. Ingestion is
additionally velocity-limited per source at 1,000 events per minute.

Resilience follows the same model with two sources, and its guard is documented
in the file itself: an unknown source token is refused rather than falling back to
the shared internal token, and every failure returns the same
`UnauthorizedException` so probing cannot distinguish "wrong token" from "unknown
source".

Both operator surfaces derive their authorization from one place. The Gateway's
`OperatorsController` and `ResilienceController` read the operator session cookie
and call the Risk service's `/validate`; the recovery controller additionally
parses the result and requires `role: 'SECURITY_OPERATOR'`, throwing
`OPERATOR_UNAUTHORIZED` if the shape does not match. Neither controller reads the
customer session cookie, and neither has a branch that accepts a customer session
as a fallback — the cookie names are different constants
(`operatorSessionCookieName` versus `sessionCookieName`) and only the operator
ones appear in these files. Mutations on both surfaces additionally require the
operator double-submit CSRF token, so an operator's ambient cookie cannot be used
by a malicious page to apply a control or acknowledge a failed drill.

### Browser-facing gateway

CORS is `origin: LOCAL_WEB_ORIGIN` — the single constant `http://localhost:3000` —
with `credentials: true` and an explicit four-method list. There is no wildcard,
no reflected `Origin`, and no environment variable that widens it. The other six
services register no CORS middleware at all, which is why G-02 is recorded as not
applicable rather than confirmed: a browser cannot usefully address them, and
`services/resilience/src/app.setup.ts` and `services/sabcl-router/src/app.setup.ts`
say so in comments. The Gateway binds `127.0.0.1` explicitly in its `main.ts`;
every other service binds its configured host, and each configuration loader
defaults that host to `127.0.0.1`.

CSRF is a double-submit check in one shared function, `requireCsrfToken`, used by
every state-changing route so the comparison cannot drift between controllers. It
compares with `timingSafeEqual` and rejects a zero-length cookie value, which
closes the case where an absent cookie and an absent header would otherwise
"match".

Cookies are serialised by one function with an explicit attribute list:
`Path=/`, `Max-Age`, `SameSite=Lax`, `HttpOnly` on the session cookie, and
`Secure` when `nodeEnvironment === 'production'`. The CSRF cookie is deliberately
readable by script — that is what makes double-submit work. `Secure` being
conditional is correct for a prototype served over plain HTTP on loopback, and
the absence of local TLS is recorded as a deferred control below rather than
presented as a design choice.

`classifyRateLimitBucket` is worth reading in full. The earlier rule derived a
bucket name from a path segment, which meant `/api/v1/<anything>/x` minted a
fresh budget — an attacker could both evade the limit and churn the window map.
The current rule classifies against two fixed allowlists: a set of known
top-level segments, and a map of authentication families with individual limits
(`session` 120, `onboarding` 60, `fallback` 40, `passkeys` 60, `logout` 60).
Anything unrecognised falls into a shared restrictive bucket at 20 — one for an
unknown top-level segment and one for an unknown authentication family. Because the
returned name is drawn only from these constants, the set of possible bucket
names is finite and known at build time. The middleware keys on
`ip:bucketName`, caps the window map at 10,000 entries, and emits a
`RATE_LIMIT_VIOLATION` security event on breach inside a `try`/`catch` so
telemetry can never turn a correct 429 into a 500.

**G-06 — residual risk.** `AppModule.configure` applies `AuthRateLimitMiddleware`
to `api/v1/auth/*`, `api/v1/accounts/*`, `api/v1/transfers/*` and
`api/v1/security-ops/*`. `api/v1/channels/*` is a known bucket in the classifier
but is not in the `forRoutes` list, so QR, USSD and agent-cash routes are
unthrottled at the Gateway. Downstream limits still apply — Payments enforces
per-agent daily limits and per-transaction ceilings, and Identity independently
rate-limits step-up attempts — but the flood brake in front of them is missing on
this family. The fix is a one-line addition to `forRoutes`; it is recorded rather
than made because this review documents the state of the release.

**G-07 — residual risk.** `ChannelsController.ussdWebhook` forwards
`POST /api/v1/channels/ussd/webhook` to Payments with no session resolution, no
CSRF check and no provider signature. Its comment states that "MSISDN auth is
done by Payments/Identity", and that is not what the code does — see C-02 and
C-03. What limits the blast radius is examined below.

### Inclusive channels

QR Pay is sound. `signQrPayload` HMACs a canonical string of the payload fields
with `PAYMENTS_QR_SIGNING_KEY`, every payload carries a 16-byte random nonce and
an `expiresAt`, dynamic codes are single-use (`QR_ALREADY_REDEEMED`), and
`PAYMENTS_QR_SIGNING_KEY` is one of the values the Payments configuration refuses
to start with in production if it still matches a placeholder. Signature
comparison uses `timingSafeEqual`. The gateway's QR confirm route resolves the
customer from the session, enforces CSRF, requires an `Idempotency-Key` matching
`/^[A-Za-z0-9._:-]{16,128}$/`, and performs a PIN step-up at Identity before
Payments is called at all. Agent cash follows the same shape and adds per-agent
daily velocity checks and a per-transaction ceiling.

USSD is where this review's most serious findings are.

**C-02 — residual risk.** In `UssdService.handleWebhook`, the `SEND_MONEY_PIN`
state compares the caller's input against the string literal `'123456'`. The
line carries a comment describing it as mock verification for telco webhook
tests. It is not reachable from the browser-facing simulator path in the sense
that matters — `handleSimulate` calls the same function — so the literal is the
only PIN check on the USSD flow regardless of entry point. Nothing about it is
production-shaped: it is not a hash, not a per-user secret, not rate-limited and
not locked out.

**C-03 — residual risk.** `USSD_PROVIDER_SECRET` is declared in `.env.example`
and is required by `pnpm env:check` (`infra/scripts/env.mjs`), which gives a
reader the impression that the telco webhook is authenticated by a
provider-specific secret. It is not: the variable appears nowhere in
`services/payments/src/common/config/payments.config.ts` and nowhere in any
Payments source file outside test fixtures. The webhook's actual protection is
the Payments internal-token guard, which is applied application-wide as an
`APP_GUARD` and which `UssdController` does not exempt — so a direct call to
Payments on 4104 is refused without `PAYMENTS_INTERNAL_TOKEN`, and Payments binds
loopback. The exposure is therefore specifically the Gateway route in G-07, which
holds that token and will attach it.

**C-04 — residual risk.** The documented risk model is that scoped controls are
enforced independently at the Gateway, Payments and Identity. That is true of the
standard transfer path: `TransfersController` calls `risk.check` and
`risk.evaluate` before confirming, and `TransfersService` calls
`PaymentsRiskClient.enforce`, which checks active controls and refuses any
assessment outside `ALLOW` / `ALLOW_WITH_MONITORING`. Neither `QrService`,
`AgentService` nor `UssdService` imports `PaymentsRiskClient`, and the Gateway's
`ChannelsController` does not call `risk.check`. A scoped control that blocks a
customer from transferring therefore does not, by itself, block that customer
from redeeming a QR code or completing an agent cash operation.

**What limits the damage.** The unauthenticated USSD webhook cannot move money,
and the reason is architectural rather than incidental. `handleWebhook` builds
its transfer with `senderCustomerId` and `sourceAccountId` both set to the
placeholder `'00000000-0000-0000-0000-000000000000'` when no customer is
supplied, and the Ledger's `CustomerTransferService.resolve` looks the source
account up with `findFirst({ where: { id: sourceAccountId, customerId:
senderCustomerId } })`, throwing `accountNotFoundError()` on a miss. The Ledger is
the sole balance authority and it refuses. The error text that comes back is
bounded and non-sensitive — `LedgerCallError`'s message is the fixed string
`'Ledger request failed.'` — so the failure does not leak internals either. What
an unauthenticated caller _can_ do is create bounded Redis session state
(five-minute TTL, deleted on session end) and use the recipient-resolution step
as an account-existence oracle, since "Account not found" and "Enter amount in
LKR:" are distinguishable responses.

### Money and the ledger

Every monetary value in the Ledger is a `BigInt` count of minor units and crosses
service boundaries as a decimal **string**, never a JavaScript number, because a
balance can exceed `Number.MAX_SAFE_INTEGER`. `parseMinorUnits` accepts only
`/^-?(?:0|[1-9]\d{0,23})$/`, so a decimal point or an exponent is rejected at the
boundary rather than silently truncated. The Payments configuration parses its
limits with the same discipline (`/^[1-9]\d{0,23}$/` → `BigInt`) and validates
that `min ≤ max ≤ dailyLimit` at startup. Database columns are `BIGINT`.

**M-02 — residual risk.** One place breaks the rule. `UssdService`'s
`SEND_MONEY_AMOUNT` state computes
`Math.floor(parseFloat(userInput) * 100).toString()`. That is IEEE-754 binary
floating point applied to a currency amount: `parseFloat('0.29') * 100` is
`28.999999999999996`, and `Math.floor` turns it into 28 — a one-cent loss for the
sender at a boundary a user can hit by typing an ordinary amount. The correct
implementation splits the string on the decimal point and assembles the minor
units with integer arithmetic, as the rest of the platform does. This is the only
float path found in the money handling.

Integrity is enforced in the database, not only in application code.
`assert_journal_integrity` is a `DEFERRABLE INITIALLY DEFERRED` constraint trigger
that runs at commit and raises on a journal with fewer than two postings, mixed
currencies, a posting to a foreign-currency account, or debits that do not equal
credits (`AEGIS_LEDGER_UNBALANCED_JOURNAL`). Deferral is what makes a two-sided
transfer expressible at all: the intermediate state after the first posting is
necessarily unbalanced. Separately, `reject_financial_mutation` fires
`BEFORE UPDATE OR DELETE` on `journal_entries` and `journal_postings` and raises
`AEGIS_LEDGER_APPEND_ONLY_VIOLATION`, so history cannot be rewritten even by the
owning role. Payments applies the same treatment to `transfer_events`; Risk to
`security_events`, `risk_assessments`, `rule_set_versions`, `control_events`,
`incident_events` and `operator_audits`; Resilience to `drill_events`,
`drill_reconciliations` and the identity fields of `backup_sets`.

### Data at rest and recovery tooling

The PostgreSQL init script validates every identifier against `[a-z0-9_]`,
rejects duplicates, refuses to reuse the administrative database or role name,
and then creates each service role `NOSUPERUSER NOCREATEDB NOCREATEROLE
NOREPLICATION NOBYPASSRLS NOINHERIT`. Per database it revokes `CONNECT` from
`PUBLIC`, grants it to the owning role and the admin role only, revokes `CREATE`
on `public` from `PUBLIC`, and creates an `app` schema owned by the service role
with `ALL` revoked from `PUBLIC`. Five databases, five roles, no cross-database
grants: `aegis_identity`, `aegis_ledger`, `aegis_payments`, `aegis_audit` (owned
by Risk) and `aegis_resilience`.

`docker-compose.yml` publishes both containers as
`'127.0.0.1:${PORT}:5432'` and `'127.0.0.1:${PORT}:6379'`. The host-IP prefix is
the control: without it, Docker's published ports bypass most host firewalls and
a laptop on a café network would be serving PostgreSQL to the room. Redis
requires a password via `--requirepass`.

**No HTTP endpoint runs a shell command.** Searching every `src/` tree under
`apps/`, `services/` and `packages/` for `child_process`, `spawn`, `exec` and
`execSync` returns nothing at all. The only files in the repository that import
`node:child_process` are test harnesses (`apps/api-gateway/test/service-process.ts`,
`apps/web/e2e/run.mjs`), the infrastructure scripts (`infra/scripts/infra.mjs`,
`infra/scripts/stack.mjs`) and two operator CLI scripts
(`services/resilience/scripts/dr-lib.mjs`, `services/resilience/scripts/drill.mjs`),
none of which is imported by any Nest module. `DrillController`
states the boundary explicitly: the Resilience service records what the tooling
reports and performs none of the work itself. Every `run()` call passes an
argument array, never a shell string, so a database name can never be
interpreted as shell syntax, and passwords travel in `PGPASSWORD` rather than on
a command line where the process table would show them.

Backup-set handling is defensive in a specific order: schema, then file presence,
then checksum, then decryption. `assertSafeFileName` requires a manifest entry to
be a plain name — `fileName !== basename(fileName)` is rejected, as are leading
dots and anything outside `[A-Za-z0-9][A-Za-z0-9._-]{0,127}` — so traversal is
blocked before a name is ever joined to a directory. `assertRegularFile` uses
`lstatSync` and refuses a symbolic link, closing the case where a set on shared
storage points at a file outside itself. `verifyChecksum` compares SHA-256 over
the **ciphertext** with `timingSafeEqual` before `decryptBackupFile` is called, so
a corrupted set is rejected without the key ever touching it. AES-256-GCM
authenticates an 8-byte magic and a version byte as additional data, so a file
cannot be replayed as a different format version.

A backup set identifier is an opaque token, not a path: `assertSafeSetIdentifier`
rejects `..`, `/` and `\` explicitly, and `parseSetSelection` has no default at
all — a bare `pnpm dr:backup:verify` or `pnpm dr:restore:verify` fails with usage
text rather than guessing. `--latest` compares the manifest's `createdAt`, never
the directory name (set directories end in a random suffix, so lexicographic
sorting would pick the largest random value rather than the newest set), and two
sets sharing the newest timestamp is an error rather than a coin toss.

`restore-verify.mjs` cannot write to a live database. Each target is
`aegis_verify_<service>_<12 hex chars>` generated per run; the script builds the
set of live database names from the five `*_DATABASE_URL` variables and throws
`'Refusing to restore over an active service database.'` if a generated name
collides; the name is additionally checked against `/^[a-z0-9_]{1,63}$/` before it
reaches SQL. There is no flag, argument or environment variable that redirects
the target — `--set` names which backup to read, never where to write. Each
decrypted dump is removed with `rmSync` as soon as `pg_restore` has consumed it,
every created database is dropped in `finally`, and a cleanup failure sets a
non-zero exit code rather than being swallowed.

These refusals are proven against real bytes, not only synthetic ones.
`backup-negative.mjs` copies a set that `backup.mjs` actually produced from live
PostgreSQL databases and applies nine mutations — wrong key, tampered ciphertext,
missing file, incomplete set, duplicate service, `../escaped.dump.enc` filename,
unsupported manifest version, unsupported algorithm, symlink escape — requiring a
refusal for each, and verifying a pristine control copy first so the refusals
mean something. `dr-lib.test.mjs` covers the same ground plus selection semantics
in 27 unit tests. CI runs both, and additionally asserts that a bare verify
fails, that an unknown set is reported rather than substituted, and that
`--set ../../etc/passwd` is refused.

### SABCL and telemetry

`loadSabclEnvironment` returns `null` only when the mode is `off`. In `strict` it
refuses placeholder material by pattern _and_ refuses the deterministic test
fixtures by identity — two distinct checks, because a fixture key is
indistinguishable from real random bytes by inspection and would otherwise pass
silently. `compatible` throws when `NODE_ENV=production`, and `pnpm env:check`
reports the same condition with the reason: compatible allows a plaintext
fallback.

The fallback itself is gated correctly. In `LedgerClient` and `PaymentsClient`,
the compatible-mode branch is `if (error instanceof SabclError && !this.sabcl.strict)`.
In strict mode the branch is not reachable and the caller receives a 503 —
a router outage surfaces as an outage, never as a plaintext retry.
`SabclTransportService.call` throws `SABCL_NOT_CONFIGURED` rather than returning a
plaintext result, so there is no implicit downgrade inside the transport either.

The router holds no key that opens a payload: its route table maps opaque tokens
to destination URLs, not to decryption keys, so `ct` is opaque bytes in that
process. Capability path patterns are anchored at both ends with constrained
identifier segments (`packages/sabcl/src/catalog/capabilities.ts`), and read
capabilities are separated from posting capabilities so a read-only caller cannot
be granted the ability to move money by holding one token.

Telemetry cannot become a leak channel. `safeRiskAttributesSchema` allowlists
exactly fifteen attribute names — `operation`, `outcome`, `amountMinor`,
`currency`, `failureCode`, `httpStatus`, `route`, `method`, `stepUpVerified`,
`recipientIsNew`, `regionCode`, `previousRegionCode`, `requestCount`,
`sourceVersion` and `integrityCode` — and rejects anything else, so no caller can
attach a PIN, a code or a phone number to a security event. The subject,
account, session, device and recipient identifiers are separate schema fields
constrained to opaque identifiers, never free-form attributes. Identity's
`AuthEventService` masks the phone (`maskPhone`) and hashes the user agent before
persisting. The demonstration
evidence capture scans each page's rendered text for nine forbidden patterns —
six-digit codes, PIN literals, session and CSRF cookie names, internal token
headers, bearer tokens, connection strings, account references and private-key
headers — and fails the run naming the category without ever quoting the match,
because a failure message that echoed the secret would put it into the log that
reports it.

---

## Verification status

| Check                                                                                         | Status                               |
| --------------------------------------------------------------------------------------------- | ------------------------------------ |
| `pnpm audit --prod`                                                                           | PASS LOCALLY                         |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`                              | PASS LOCALLY                         |
| Unit, tooling, contract and web component tests                                               | PASS LOCALLY                         |
| Repository and history secret enumeration                                                     | PASS LOCALLY                         |
| Integration, end-to-end, Playwright functional and accessibility suites                       | NOT RUN LOCALLY — Docker unavailable |
| `pnpm dr:backup`, `pnpm dr:backup:verify:negative`, `pnpm dr:restore:verify`, `pnpm dr:drill` | NOT RUN LOCALLY — Docker unavailable |
| The above, plus four reconciliations and cleanup                                              | PASS IN CI (authoritative)           |

CI is exactly four jobs — lint, typecheck, test, build. The test job runs real
PostgreSQL 17 and Redis in Docker, applies all five committed migration sets, and
never uploads a dump, a decrypted file, an `.env`, a token or a key; its only
artifact is a Playwright report on failure. A step that always runs deletes the
backup working directory, asserts that no `*.dump` survived the drill, and fails
the job if any `/tmp/aegis-dr-*` staging directory was left behind.

---

## Deferred production controls

None of the following is implemented. Each is listed with what the prototype does
instead, so a reader can see the size of the gap rather than a label.

**Key custody and rotation with re-encryption.** `DR_BACKUP_ENCRYPTION_KEY`,
`FIELD_ENCRYPTION_KEY`, `PAYMENTS_QR_SIGNING_KEY`, `SABCL_ROUTE_SECRET` and the
SABCL private keys are environment variables read from a git-ignored `.env`.
`parseBackupKey` enforces exactly 32 bytes and rejects an all-zero key, and SABCL
supports key rotation and revocation through its keyring, but there is no
hardware security module, no key hierarchy, no custody procedure and — the
important omission — **no re-encryption of existing backup sets when the backup
key changes**. Rotating `DR_BACKUP_ENCRYPTION_KEY` today makes every prior set
unreadable. Production needs an envelope scheme with a per-set data key, so
rotating the master key rewraps data keys instead of orphaning ciphertext.

**Offsite immutable backup storage.** Backup sets are written to `.dr-backups/`
on the operator's own machine, which is the same failure domain as the databases
they protect. There is no replication, no offsite copy, no object-lock or
write-once storage, and no retention enforcement beyond the documented procedure
in `docs/security/backup-retention-and-disposal.md`. Ransomware that reaches the
operator machine reaches the backups.

**Manifest signing.** `canonicalManifestBytes` and `sha256Hex` produce a stable
manifest checksum, and each file is checksummed and authenticated by AES-256-GCM,
so tampering with a _file_ is detected. The manifest itself is not signed. An
attacker who can write to the backup directory can produce an internally
consistent manifest for a set of their own files. The primitives are already
present — the SABCL package has Ed25519 signing — so the missing piece is a
signing key with custody, which is the previous item.

**Production workforce identity and multi-factor authentication.** Security
operators bootstrap from `RISK_OPERATOR_BOOTSTRAP_TOKEN`, a single shared static
token that the Risk configuration refuses outright when `NODE_ENV=production`
(which means there is currently _no_ production operator sign-in path at all).
There is no identity provider, no SSO, no per-operator credential, no MFA and no
device trust. Operator sessions are opaque and expiring with CSRF on mutations,
and every action is written to the append-only `operator_audits` table, so the
audit trail exists — but it attributes actions to a bootstrap identity rather
than to a person.

**Separation of duties.** One operator can plan a drill, acknowledge a failed
one, apply a control and release it. There is no maker-checker, no dual
authorization for high-impact actions and no role beyond `SECURITY_OPERATOR`.
The partial control that does exist is architectural: the recovery console has no
route that starts a backup, starts a restore, names a file, names a database or
supplies a key, because none of those belongs to a browser. Destructive recovery
work requires shell access to the operator machine, which is a different
credential from an operator session.

**A trained fraud model.** `services/risk/src/assessments/risk-engine.ts`
evaluates deterministic integer-weight rules and persists an explanation for
every assessment, which makes decisions reproducible and auditable — a genuine
property, and the right foundation. It is not a fraud model. There is no
training data, no feature store, no model governance, no drift monitoring and no
measured false-positive rate. Thresholds such as `RISK_HIGH_VALUE_MINOR` are
configured values, not learned ones.

**TLS in transit locally.** Everything speaks plain HTTP on loopback. The
`Secure` cookie attribute is therefore conditional on `NODE_ENV=production`
(`apps/api-gateway/src/auth/cookies.ts`), which is correct for the local posture
and useless as a production control on its own. SABCL provides application-layer
confidentiality and authenticity between services when it is enabled, but it
ships `off` by default and does not cover the browser-to-Gateway hop at all.
Production needs TLS everywhere, HSTS, and `Secure` unconditionally.

**Secret management.** Secrets live in a `.env` file. `pnpm env:check` validates
that they are present, well-formed and not placeholders, and it never prints a
value — the report names variables and describes problems only. `pnpm env:init:local`
generates local secrets and refuses to overwrite an existing file. That is good
hygiene for a laptop and is not secret management: there is no vault, no dynamic
issuance, no automatic rotation, no per-environment scoping and no access audit
on the secrets themselves.

**Continuous monitoring.** The prototype produces the raw material — structured
JSON request logs, append-only security events with source health tracking, an
operator console showing 24-hour event counts and risk-band distribution, and
four reconciliations available through `pnpm reconcile:all`. Nothing collects,
aggregates, retains or alerts on any of it. There is no log shipping, no metrics
backend, no tracing, no on-call rotation and no alert that reaches a human. A
reconciliation that fails at 03:00 fails silently until someone runs the command.

---

## Standing limitations

These are stated in `README.md`, `SECURITY.md` and
[the release notes](RELEASE_NOTES.md), and nothing above contradicts them.

AEGIS Shield does **not** provide production multi-region disaster recovery,
continuous replication, zero data loss, compliance certification, a guaranteed
production recovery-point or recovery-time objective, protection against the loss
of a cloud region or provider, a trained fraud model, production workforce
identity, external payment rails, or production messaging.

Recovery figures produced by `pnpm dr:drill` are a **measured prototype
recovery-point age** and a **measured prototype recovery duration**, taken from a
drill against local disposable infrastructure. They are measurements of one run
on one machine, not objectives and not guarantees.

Use synthetic data only. Never real money, never real credentials, never a real
customer.

## Related documents

- [Security policy and disclosure](../../SECURITY.md)
- [Authentication threat model](../security/authentication-threat-model.md)
- [Transfer threat model](../security/transfer-threat-model.md)
- [Inclusive channels threat model](../security/inclusive-channels-threat-model.md)
- [SABCL threat model](../security/sabcl-threat-model.md)
- [SABCL key management](../security/sabcl-key-management.md)
- [Threat detection threat model](../security/threat-detection-threat-model.md)
- [Operator authorization model](../security/operator-authorization-model.md)
- [Recovery operator authorization](../security/recovery-operator-authorization.md)
- [Disaster recovery threat model](../security/disaster-recovery-threat-model.md)
- [Backup encryption and key management](../security/backup-encryption-and-key-management.md)
- [Backup retention and disposal](../security/backup-retention-and-disposal.md)
- [Ledger integrity model](../security/ledger-integrity-model.md)
- [Incident response runbook](../security/incident-response-runbook.md)
- [Backup and restore runbook](../operations/backup-restore-runbook.md)
- [Disaster recovery runbook](../operations/disaster-recovery-runbook.md)
