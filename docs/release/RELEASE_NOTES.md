# AEGIS Shield — Release Notes

AEGIS Shield is a zero-trust, resilient and inclusive digital banking **prototype**
built for Duothan 6.0 Phase 2. This release closes the sequence of prompts 00 to
12: the platform is feature-complete against the scope it set for itself, every
capability is owned by an independently runnable service, and the whole surface —
commands, ports, links and release documents — is now checked by an automated
suite rather than by memory.

This is not a production banking system. It holds no real money, connects to no
external payment rail, and makes no availability or compliance guarantee. The
[Known limitations](#known-limitations) and [Not included](#not-included)
sections at the end are not boilerplate; they are the parts of these notes that
must never be contradicted by anything above them.

---

> **Known blockers in this release.** Six confirmed defects in the USSD and
> agent-cash channels are documented in
> [the final security review](./final-security-review.md#release-blockers) and
> are not fixed. Those two channels are not safe to demonstrate as working.

## The stack this release ships

| Component        | Port | Owns                                                                |
| ---------------- | ---- | ------------------------------------------------------------------- |
| Web (Next.js)    | 3000 | Multilingual customer UI and the two operator consoles              |
| API Gateway      | 4000 | The only public HTTP surface: cookies, CSRF, contracts, rate limits |
| Identity service | 4101 | Users, OTP challenges, PIN, passkeys, opaque sessions               |
| Ledger service   | 4102 | Accounts, immutable journals and postings, balances                 |
| SABCL router     | 4103 | Blind routing of encrypted envelopes it cannot read                 |
| Payments service | 4104 | Transfers, QR Pay, USSD, agent cash, idempotency                    |
| Risk service     | 4105 | Security events, assessments, scoped controls, incidents            |
| Resilience svc.  | 4106 | Recovery drill evidence and the backup-set registry                 |
| PostgreSQL       | 5432 | Five service databases, one least-privilege login role each         |
| Redis            | 6379 | Sessions, challenges, velocity counters, replay claims              |

Every service except the Gateway and the web application binds to loopback and
carries no browser CORS, so the only way in from a browser is through the
Gateway. The SABCL router starts only when `SABCL_MODE` is something other than
`off`; `.env.example` ships `off`, so a first run brings up a working stack
without requiring key material.

The five PostgreSQL databases are `aegis_identity`, `aegis_ledger`,
`aegis_payments`, `aegis_audit` (owned by Risk) and `aegis_resilience`. No
service reads another service's tables.

---

## What changed in the final release

Prompt 12 added no new banking capability. It closed the gap between a platform
that works when the person driving it already knows how, and a platform a
stranger can start, verify, reconcile and audit. Seven changes, each of which
exists because the previous state had a specific failure mode.

### Backup sets are now selected explicitly

A bare `pnpm dr:backup:verify` or `pnpm dr:restore:verify` **now fails**. The set
must be named, either by identifier or by an explicit request for the newest one:

```bash
pnpm dr:backup:verify -- --set <backup-set-id>
pnpm dr:backup:verify -- --latest
pnpm dr:restore:verify -- --set <backup-set-id>
```

The reason is that "whichever set the tool happened to pick" is not an answer an
operator can act on after an incident — a verification that silently examined a
different set than the operator had in mind records evidence about bytes nobody
chose. `--latest` compares the manifest's `createdAt`, never the directory name,
so a set restored out of order or copied from another machine cannot be picked by
accident; and two sets sharing the newest creation time is an error that asks the
operator to name one, not a coin toss. An identifier shaped like a path is
refused outright. The selected identifier is printed _before_ any work starts, so
the operator sees which set is being examined even when verification then fails.

CI asserts those refusals against a real backup set: a bare command, an unknown
identifier and a path-shaped identifier are each rejected, while `--latest` still
succeeds.

### Environment tooling

```bash
pnpm env:init:local            # create .env from .env.example with generated secrets
pnpm env:init:local -- --force # replace an existing .env
pnpm env:check                 # validate it
```

`env:check` names the variable and describes the problem; it never prints a
value, because a misconfiguration report that echoed the offending value would
put a password into a terminal scrollback, a CI log or a screenshot — exactly the
disclosure the configuration existed to prevent. It validates presence per
capability group, port ranges, PostgreSQL and Redis URL shapes (Redis must carry
a password), and that each service's connection URL actually names that service's
database and login role. Under `NODE_ENV=production` it additionally refuses
`DEMO_AUTH_ENABLED=true`, a set `RISK_OPERATOR_BOOTSTRAP_TOKEN`,
`SABCL_MODE=compatible`, a missing `DR_BACKUP_ENCRYPTION_KEY`, WebAuthn settings
pointing at localhost, and any secret still carrying a shipped placeholder.

`env:init:local` generates cryptographically random values for every password,
internal token, source token, QR signing key and field-encryption key, generates
a 32-byte AES key for `DR_BACKUP_ENCRYPTION_KEY`, and rebuilds the connection
URLs from the regenerated components so a URL cannot drift from the password it
embeds. It refuses to overwrite an existing `.env` unless `--force` is given, and
it writes only to the git-ignored file — no generated secret reaches stdout.

### One-command demonstration

```bash
pnpm demo:start              # env check → Docker check → infra → migrations → services
pnpm demo:status             # what is listening
pnpm demo:stop               # stop containers, keep data
pnpm demo:reset -- --yes     # destroy local volumes, explicit confirmation required
```

`demo:start` runs an ordered plan: validate the environment, confirm the Docker
engine answers, start PostgreSQL and Redis, check infrastructure health, apply
all five committed migration sets, then start Identity, Ledger, the SABCL router
(skipped when `SABCL_MODE=off`), Payments, Risk, Resilience, the Gateway and the
web application. The router deliberately comes up after the services it forwards
to and before the Gateway that sends through it, so a strict-mode Gateway starts
with a reachable router rather than failing its first call.

Every wait polls a liveness endpoint rather than sleeping for a guessed interval,
and every wait is bounded. Ctrl+C stops every child in reverse start order and
waits for each one, so no orphan keeps a port bound and makes the next start fail
confusingly. Service output is streamed through a redactor built from the
environment by variable name, and any surviving URL userinfo is stripped as well.
Normal shutdown never deletes data; only `demo:reset -- --yes` does, and it says
so before it acts.

### The demonstration verifier

```bash
pnpm demo:verify
```

`demo:status` answers "is something listening". `demo:verify` answers the harder
question: does each service answer, and is the answer the shape it is documented
to have. Liveness and readiness are held to different shapes, because they are
different documents — liveness says the process is running, readiness says it can
do its job. The Gateway's readiness must carry `status` and `dependencies`;
Resilience readiness must carry `status`, `database` and `backupKeyConfigured`.

The verifier also asserts a negative: a health document must not contain
`databaseUrl`, `redisUrl`, `password`, `token`, `internalToken`, `encryptionKey`,
`backupKey` or `stack`, and must not contain a PostgreSQL or Redis connection
string anywhere in its serialised form. A readiness endpoint answering 503 is
reported as degraded rather than broken, because refusing to claim readiness is
the endpoint doing its job. Response bodies never reach the report — an upstream
that returned a stack trace or a connection string would otherwise print it
straight into the demonstration transcript.

### Aggregate reconciliation

```bash
pnpm reconcile:all
```

Runs the Ledger, Payments, Risk and Resilience reconciliations in sequence and
prints one table. Sequential rather than parallel on purpose: these read live
databases and two running services, and interleaved output makes a failure hard
to attribute. A failure does not stop the run, because an operator needs to know
whether one subsystem or all four disagree with themselves.

Individual results are preserved rather than collapsed into a single verdict, and
the summary is built from an allow-list of counter fields (`status`,
`issueCount`, `checkedTransfers`, `checkedIntents`, `checkedDrills`,
`checkedBackupSets`, `expiredControls`) plus issue codes and severities — never
free-text detail. An allow-list rather than a deny-list, so a future
reconciliation that started emitting an identifier cannot leak it into an
aggregated report nobody re-reviewed. Each child has a bounded lifetime and a
bounded output buffer. CI runs the Ledger, Payments and Risk reconciliations as
individual steps, runs all four again inside the disaster-recovery drill, and
then runs `reconcile:all` against the same live state.

### Evidence tooling

```bash
pnpm demo:evidence
```

Drives a real browser over nine public or synthetic pages — landing, sign-in,
Tier-0 onboarding, QR Pay, USSD, agent cash, security posture, SABCL status and
operator sign-in — at a desktop and a mobile viewport, and writes eighteen
deterministically named screenshots into the git-ignored `.evidence/` directory.
File names carry no timestamp, so re-running overwrites rather than accumulating
a pile of near-identical images to review.

There is deliberately no capture of a signed-in customer's account detail, a
transfer receipt or an operator incident: those render a real reference or a real
amount, and an image of one discloses as much as the page itself. Because images
cannot be scanned the way text can, the run also captures each page's visible
text and fails if it matches a one-time code, a PIN, a session or CSRF cookie, an
internal or bearer token, a connection string, an unmasked account reference or a
private key. Nothing is committed and nothing is uploaded — there is no network
destination in the tool — and the run ends with an explicit notice that a person
must still open every image before sharing it.

### The documentation set, and a test that keeps it true

Documentation drifts silently. A renamed command, a moved document or a link to a
file that no longer exists breaks no build and wastes the time of the next person
who follows the instructions. `infra/scripts/docs.test.mjs` turns that drift into
a test failure, and CI runs it. It asserts that:

- every `pnpm <script>` appearing in any markdown file exists in the root
  `package.json`;
- every capability command is documented _somewhere_ (internal plumbing exempt);
- every relative markdown link resolves to a file that exists;
- the six release documents exist, start with a title, are long enough to be real
  documents, and contain no placeholder text;
- no document claims an implemented capability is still future work;
- the documents that list the stack — the project README, the architecture
  overview and the final demo guide — list all of it, ports 3000 through 4106; a
  port list that omits Resilience sends an operator to a service that is not
  there.

The release set is these notes plus `docs/release/FINAL_DEMO_GUIDE.md`,
`docs/release/SUBMISSION_CHECKLIST.md`,
`docs/release/FINAL_VALIDATION_REPORT.md`,
`docs/release/final-capability-audit.md` and
`docs/release/final-security-review.md`.

---

## Capabilities

### Authentication

**Owner: Identity service, port 4101.** Public surface via the API Gateway on
port 4000; browser flows in the web application on port 3000.

Tier-0 onboarding takes a phone number with explicit consent, delivers a one-time
code, and creates an account behind an Argon2id PIN with an explicit cost
profile. OTP values are stored only as keyed digests with short lifetimes,
attempt limits, cooldowns, rate limits and one-time consumption; the raw code is
never persisted. Passkeys use WebAuthn through `@simplewebauthn/server`, with
challenges bound to a user or request context in Redis and consumed before
verification; PostgreSQL stores only public credentials, counters and safe
metadata. Discoverable credentials and user verification are required. AEGIS
receives a public-key credential and never biometric or device-unlock data.

Sessions are opaque random values stored as hashes in Redis, which buys immediate
revocation, idle expiry, absolute expiry and server-side versioning without
putting customer state or a long-lived bearer claim in the browser. The session
cookie is `HttpOnly`, `SameSite=Lax`, host-only, and `Secure` in production; a
separate readable random cookie carries the double-submit CSRF value that every
state-changing authenticated request must echo in `x-csrf-token`.

Passkeys are the primary sign-in action, with phone plus PIN and OTP kept as a
clearly available fallback for unsupported devices. No authentication data is
placed in `localStorage` or `sessionStorage` — only the interface-language
preference. Reloading an unfinished onboarding flow is intentionally destructive:
the phone number, challenge, OTP, enrollment token and PIN live in React memory
and are cleared, and the customer restarts.

The journey is complete in English, Sinhala and Tamil, with WCAG-oriented
accessibility treated as a release constraint rather than a later cleanup:
semantic landmarks, one labelled OTP field, programmatically associated errors,
focus movement, error summaries, keyboard operation, visible focus, reduced
motion, adequate touch targets and no serious or critical axe violations.

See [ADR 0004](../decisions/0004-identity-and-session-authentication.md),
[ADR 0005](../decisions/0005-authentication-user-experience.md), the
[authentication threat model](../security/authentication-threat-model.md) and the
[authentication demo](../demo/authentication-demo.md).

### Accounts and the double-entry ledger

**Owner: Ledger service, port 4102.**

Each customer gets one default Tier-0 wallet per `(customerId, productType,
currency)`, opening at exactly zero — no opening journal entry is written and no
funds are invented. Wallets are `LIABILITY` accounts, because customer money is
an obligation of the platform rather than a platform asset, so a credit increases
the visible balance and a debit decreases it. Accounts carry a synthetic
`AEGIS-XXXX-XXXX-XXXX` reference that is deliberately not a real bank account
number and is exposed outside the service only in the masked form
`AEGIS-****-****-XXXX`.

Every monetary amount is an integer count of minor units: `BIGINT` in PostgreSQL,
`BigInt` in the service, and a decimal **string** in every contract and JSON
payload. No JavaScript number and no floating-point column holds money at any
layer, because balances can exceed `Number.MAX_SAFE_INTEGER` and binary floating
point cannot represent decimal currency exactly.

Journal entries and postings are append-only. Posting amounts are always strictly
positive with the direction column carrying the sign, so a stored negative amount
cannot silently invert a balance, and corrections are made by posting a reversing
entry rather than by editing history. Correctness is enforced by PostgreSQL and
not only by TypeScript: `CHECK` constraints, unique constraints, `BEFORE UPDATE
OR DELETE` triggers that reject every mutation of a posted entry, and deferred
`CONSTRAINT TRIGGER`s that re-check at COMMIT that each journal balances, holds
at least two postings, uses one currency, and posts only to accounts in that
currency. A balance projection row is maintained inside the same transaction as
the postings that changed it, but it is an optimisation only — the authoritative
balance is always recomputable from the immutable postings, and reconciliation
compares the two.

Every state-changing operation requires an `Idempotency-Key` distinct from the
correlation ID. The service stores a hash of the key and a hash of the canonical
payload, and writes the reservation row inside the same transaction as the work,
so a concurrent duplicate blocks on the unique index rather than executing twice
and the loser replays the stored response. A key reused with a different payload
is a `409 IDEMPOTENCY_CONFLICT`; raw keys are never persisted or logged. Journal
posting locks every affected account and projection with `SELECT ... FOR UPDATE`
in a single deterministic order across all callers, which avoids deadlock and
makes the insufficient-funds check atomic — concurrent debits cannot overdraw a
wallet, and the loser gets `INSUFFICIENT_FUNDS` rather than a corrupted balance.

The Ledger performs no authentication and duplicates no Identity logic. The
Gateway derives the customer from a validated session and passes that identifier
internally; a customer identifier supplied by a browser is never trusted.

See [ADR 0006](../decisions/0006-accounts-and-double-entry-ledger.md), the
[ledger integrity model](../security/ledger-integrity-model.md) and the
[accounts and ledger demo](../demo/accounts-ledger-demo.md).

### Transaction history

**Owner: Ledger service, port 4102**, presented through the Gateway on port 4000
and rendered by the web application on port 3000.

History is a read model computed from immutable `journal_postings` joined to
posted journal entries. A browser cannot create, alter or delete a transaction
through this feature. Ownership is applied in the account lookup, so a foreign
account and a nonexistent account return the same 404 and the API cannot be used
to probe which references exist.

`balanceAfter` is calculated across the complete unfiltered posting chronology
(`createdAt ASC, id ASC`) _before_ any filter or page is applied, so a filtered
view still shows the balance the account actually had. Rows are then presented by
`postedAt DESC, UUID DESC`. `effectiveAt` describes business effect and can never
reorder the append-only posting sequence. Pagination uses versioned opaque
cursors that are bounded and cryptographically fingerprinted to the active
direction, category and date filters, so a cursor cannot be replayed against a
different filter set and discloses no raw ledger identifier.

The customer contract exposes a stable display reference, account identifier,
direction, category, posted status, monetary values as decimal strings, balance
after and timestamps — and never journal references, ledger-account identifiers,
account codes, correlation identifiers, idempotency records, descriptions,
metadata or actor fields. Responses are private and `no-store`. Previews are
masked, receipts are printable, and the whole surface exists in English, Sinhala
and Tamil.

See [ADR 0007](../decisions/0007-customer-transaction-history.md), the
[transaction-history privacy boundary](../security/transaction-history-privacy.md)
and the [dashboard and transactions demo](../demo/dashboard-transactions-demo.md).

### Secure customer transfers

**Owner: Payments service, port 4104**, with the Ledger on 4102 remaining the
sole balance authority.

A transfer combines authorization, balance correctness, retries, privacy and
partial failure, and the hard requirement is that a browser retry must not create
a second debit while a lost response must not be read as either success or
failure without evidence.

The Gateway derives the customer from an Identity session, checks double-submit
CSRF, and sends the PIN **only** to Identity for step-up verification — the PIN
stops there and never reaches Payments or the Ledger. Payments creates a
short-lived opaque intent, and on confirmation persists `PROCESSING` _before_
asking the Ledger to post one immutable `CUSTOMER_TRANSFER` journal with exactly
two postings. Payments and the Ledger each enforce idempotency at their own
boundary, and account locks are taken in sorted UUID order.

No distributed database transaction is used. An ambiguous call — one where the
Ledger's answer was lost — stays `PROCESSING`, and bounded recovery repeats the
same Ledger command with the same key until it can honestly choose `COMPLETED` or
`REQUIRES_REVIEW`. Temporary uncertainty is therefore visible and recoverable
instead of becoming a double debit. Public contracts carry masked references and
customer-safe status codes only. Reconciliation compares both services' views;
`REQUIRES_REVIEW` is investigated by an operator without editing append-only
evidence.

Amount bounds, the daily outgoing limit and the intent lifetime come from
validated configuration, and the service refuses to start if the minimum,
maximum and daily limit are inconsistent with each other, or if a production
configuration still contains a shipped placeholder.

See [ADR 0008](../decisions/0008-secure-customer-transfers.md), the
[fund transfer model](../security/fund-transfer-model.md), the
[transfer threat model](../security/transfer-threat-model.md), the
[payment idempotency and recovery design](../security/payment-idempotency-and-recovery.md)
and the [customer transfer demo](../demo/customer-transfer-demo.md).

### Inclusive channels

**Owner: Payments service, port 4104**, reached through the Gateway on port 4000.

Inclusion here means a customer without a smartphone, without data, or without
literacy in the app's language can still move money. Three channels, each with
its own trust boundary.

**QR Pay.** Payloads are signed with HMAC-SHA-256 over a canonically ordered
field string and compared with a timing-safe equality check, so an attacker
cannot alter the recipient reference, currency, amount, expiry or type without
invalidating the signature. Every payload carries a random 128-bit nonce and a
strict `expiresAt` that is validated immediately on decode. Dynamic codes expire
in minutes and static codes in hours, both from validated configuration. The
stored request keeps only hashes of the nonce and signature — never the payload —
with a unique constraint on the nonce hash, and redemption is scoped by
`(senderCustomerId, idempotencyKeyHash)` so one scan resolves to exactly one
ledger journal.

**USSD.** Session state lives server-side in Redis with a bounded five-minute
lifetime; the caller's input selects the next state transition and never carries
the transaction parameters, so a manipulated menu string cannot bypass an intent
step. The webhook and the simulator reach Payments only through the Gateway, and
every Payments route sits behind the internal-token guard, so the service accepts
no request that did not come through the public boundary. MSISDN is bound to the
customer identity, and sensitive operations require a PIN step-up validated by
Identity.

**Agent cash.** Cash-in and cash-out are two-step by design: the agent _previews_
an operation and receives a short-lived intent token, and the customer
_confirms_, which is what transfers liability from the agent's assertion to the
customer's consent. Amounts are bounded by the same validated minimum and maximum
as transfers, idempotency is scoped per agent by a unique
`(agentId, idempotencyKeyHash)` constraint combined with a canonical hash of the
request parameters, and each completed operation maps to exactly one ledger
journal. Every channel writes append-only lifecycle events, and the Payments
reconciliation checks that every `COMPLETED` QR redemption and every `COMPLETED`
agent operation carries a ledger journal identifier and flags intents that have
outlived their TTL.

See the [inclusive channels threat model](../security/inclusive-channels-threat-model.md).

### SABCL/1 — metadata-protected internal routing

**Owner: `packages/sabcl` for the protocol and the SABCL blind router service on
port 4103.**

The problem SABCL solves is not authentication. Internal calls carried their
sensitive material in the clear: `GET /internal/customers/{customerId}/accounts`
puts a customer identifier in a URL, and a transfer confirmation puts an amount,
a recipient reference and PIN authorisation in a body. Anything positioned in the
middle of that path — a proxy, a mesh sidecar, a log aggregator — learns who is
transacting, with whom, for how much, without breaking any authentication. A
bearer token does not help: it proves only "something on the internal network".

SABCL/1 seals each internal call with X25519 ECDH to a per-message ephemeral key,
HKDF-SHA-256 keyed by the message nonce and a domain-separated canonical header,
AES-256-GCM with that header as additional authenticated data, and an Ed25519
signature over header ‖ ciphertext ‖ tag — all through Node's `node:crypto`, with
no custom construction. Encryption and signing identities are separate key pairs
so they rotate independently.

The envelope is the privacy boundary. Its outer fields are opaque or structural
only: version, random message identifier, HMAC-derived route token, key
identifiers, ephemeral public key, timestamps, nonce, hop limit, padding bucket,
ciphertext, tag and signature. Endpoint paths, operation names, customer and
account identifiers, amounts, recipient references and authorisation data exist
only inside the ciphertext. The schema is strict, and a leakage test seeds each
sensitive category and scans the serialised envelope in five encodings.

Destinations are named by route token — `HMAC-SHA-256(routeSecret, domain ‖
routeId)` — deterministic so no provisioning round trip is needed, irreversible
so capture reveals nothing, and resolvable only against a table the router builds
at startup. The router exposes exactly one routing path and one method —
`POST /sabcl/v1/messages`, beside its health and operator-status reads — and has
no request shape that names a destination, so it cannot be turned into a general
proxy. It
verifies structure — version, freshness, sender-key allowlist, hop budget, rate
limit, route resolution and a Redis replay claim — and forwards the bytes
unchanged. It deliberately does **not** verify signatures; the recipient does, so
a compromised router that lied about authenticity is caught at the far end rather
than trusted. It holds no key that opens what it carries, which makes it the
least-trusted server-side element in the system by construction rather than by
policy.

A route token authorises a capability, not a service. `identity.step-up`,
`ledger.accounts`, `ledger.postings` and `payments.transfer` are separate, so one
token cannot both list accounts and move money; each declares anchored path
patterns the recipient checks before dispatch, and administrative surfaces have
no route at all. Dispatch replays the request against the service's own HTTP
surface on loopback with its internal token, so every existing guard, pipe,
filter and contract check runs unchanged and the two paths cannot drift.

Three modes: `strict` never downgrades — a router outage is an outage, never a
plaintext retry; `compatible` permits a documented fallback and is refused when
`NODE_ENV=production`; `off` keeps the direct internal calls and is what
`.env.example` ships. Strict startup rejects placeholder values and, by
recomputing them, the deterministic test fixtures — which are otherwise
indistinguishable from real key material.

Honesty about the limit: padding hides exact payload size within a bucket and
nothing more. Timing, frequency and order-of-magnitude size remain observable,
and the operator status page says so. The layer protects data in transit between
services and offers nothing once a recipient has decrypted it.

See [ADR 0009](../decisions/0009-sabcl-privacy-and-secure-routing.md), the
[protocol specification](../security/sabcl-protocol.md), the
[metadata leakage analysis](../security/sabcl-metadata-leakage.md), the
[threat model](../security/sabcl-threat-model.md),
[key management and rotation](../security/sabcl-key-management.md),
[route-token provisioning](../security/sabcl-route-provisioning.md), the
[replay and expiry design](../security/sabcl-replay-and-expiry.md), the
[operations runbook](../security/sabcl-runbook.md), the
[router README](../../services/sabcl-router/README.md) and the
[SABCL routing demo](../demo/sabcl-routing-demo.md).

### Threat detection and scoped controls

**Owner: Risk service, port 4105**, owning the `aegis_audit` database; the
security-operator console lives at `/security-ops` in the web application on port 3000.

Gateway, Identity, Payments, Ledger and infrastructure adapters publish strict,
versioned, authenticated and idempotent security events to Risk. Risk persists
the original fact, updates bounded Redis velocity counters, evaluates
deterministic integer-weight rules, and stores the explanation alongside the
score.

Rule set `risk-rules-2026-08-v1` covers authentication-failure bursts, request
and transfer velocity, cumulative outgoing value, high value, new-recipient high
value, insufficient-funds bursts, replay and idempotency conflicts, shared device
clusters, integrity anomalies, internal authentication failures, repeated CSRF or
malformed sensitive requests, known blocked scopes and existing incidents or
controls. Scores cap at 100 with bands LOW 0–24, MEDIUM 25–49, HIGH 50–74,
CRITICAL 75–100, and map to decisions `ALLOW`, `ALLOW_WITH_MONITORING`,
`REQUIRE_STEP_UP`, `HOLD_FOR_REVIEW`, `BLOCK` and `QUARANTINE`. A known active
block takes priority over an aggregate score. Every triggered rule and reason
code is stored, so a decision can be explained after the fact rather than
asserted.

Controls are typed (`REQUIRE_STEP_UP`, `TEMPORARY_BLOCK`, `TRANSFER_HOLD`,
`RECIPIENT_BLOCK`, `SESSION_REVOKE`, `ACCOUNT_RESTRICT`, `MANUAL_REVIEW`,
`QUARANTINE`), scoped (`CUSTOMER`, `SESSION`, `DEVICE`, `ACCOUNT`, `RECIPIENT`,
`OPERATION`, `SERVICE`) and expiring, so a control cannot silently become
permanent and cannot disable an unrelated subject. Enforcement is deliberately
repeated at meaningful boundaries: the Gateway checks active controls before
transfer step-up and assesses the authenticated subject after it; Payments
independently assesses its own authoritative intent — its amount, account and
recipient — immediately before creating a posting operation; Identity alone
revokes sessions, through an explicit authenticated internal command. Incidents
and operator audit are append-only.

Failure policy is split on purpose. Telemetry is generally fail-open for normal
authentication and non-posting reads, so a Risk outage does not lock every
customer out. Transfer enforcement and operator mutations are fail-closed with
bounded two-second timeouts, so a Risk outage cannot be used as a way to get a
sensitive operation past the checks. The development operator bootstrap is
refused under `NODE_ENV=production`.

See [ADR 0010](../decisions/0010-threat-detection-and-automated-controls.md), the
[threat detection architecture](../architecture/threat-detection-and-controls.md),
the [rule catalogue](../security/risk-rule-catalogue.md), the
[automated control policy](../security/automated-control-policy.md), the
[risk event contract](../security/risk-event-contract.md), the
[failure policy](../security/risk-failure-policy.md), the
[privacy and retention policy](../security/risk-privacy-and-retention.md), the
[operator authorization model](../security/operator-authorization-model.md), the
[incident response runbook](../security/incident-response-runbook.md) and the
[risk controls demo](../demo/risk-controls-demo.md).

### Operational resilience and disaster recovery

**Owner: Resilience service, port 4106**, owning `aegis_resilience`; the recovery
operations console lives at `/security-ops/resilience` in the web application on
port 3000.

The service records recovery **evidence** and nothing else: which encrypted
backup sets exist by identifier and checksum, which drills ran and what state
they reached, an append-only event history per drill, per-service reconciliation
results attached to a drill, and an operator acknowledgement for a failure. It
holds no customer data, no balances and no dump contents, and it never holds the
backup encryption key — it validates that one is configured and records only the
boolean `backupKeyConfigured`.

There is no HTTP route that runs a backup, runs a restore, executes a shell
command, accepts a filesystem path or accepts a database connection string.
Backup and restore are operator command-line tooling, because a console button
that shelled out to `pg_dump` is remote command execution behind a login, and no
amount of authorization makes that safe. The cost of that choice is real — an
operator cannot start a drill from the browser, only record that one is planned —
and it is the intended trade.

A backup set is a directory holding one `pg_dump --format custom --no-owner
--no-acl` output per database, each encrypted with AES-256-GCM under the layout
`magic "AEGISBK1" ‖ version ‖ nonce ‖ tag ‖ ciphertext` with the header
authenticated as additional data, plus a manifest. The set is published
atomically — written to staging and renamed into place only once every dump has
been taken, encrypted, checksummed and listed — so a reader never sees a
half-written set that would restore an inconsistent platform. The five
authoritative PostgreSQL databases are in scope. **Redis is deliberately not
backed up**: it holds recreatable cache, replay and velocity state, so backing it
up would preserve nothing a restore could not rebuild while widening what a
stolen set exposes. After a restore, customers sign in again; that is the correct
outcome, not a gap.

Verification checks the manifest schema, safe file names, known services and
complete coverage, then verifies every file's SHA-256 **before decrypting
anything**, so a corrupted set is rejected without the key ever touching the
bytes. Decryption then proves both the key and the ciphertext's authenticity.
Isolated restore verification creates a freshly named disposable database per
service, `aegis_verify_<service>_<random>`, checked against the live database
names, runs `pg_restore --no-owner --no-acl --exit-on-error` into it, asserts the
result actually contains application tables rather than merely existing, and
drops everything it created and every decrypted file in a `finally` block whether
the run passed or failed. There is no flag, environment variable or argument that
can redirect a restore onto a live database.

Drills advance through a validated state machine — `PLANNED → RUNNING →
BACKUP_CREATED → RESTORE_VERIFIED → RECONCILIATION_PASSED → PASSED → CLEANED_UP`,
with any state able to move to `FAILED → CLEANED_UP`. An out-of-order or terminal
move is a `409`, never a silent overwrite, so a drill cannot record a successful
recovery it never performed. Drill events and reconciliation results are
append-only through PL/pgSQL triggers rather than by convention, and a backup
set's identifying fields are immutable so a substituted set cannot inherit
another set's verification.

The figures a drill produces are named for exactly what they are:
`measuredRecoveryPointAgeSeconds` and `measuredRecoveryDurationMs` — a **measured
prototype recovery-point age** and a **measured prototype recovery duration**
taken against local disposable infrastructure on one machine. They are not an RPO
or an RTO, and they are not a guarantee.

See [ADR 0011](../decisions/0011-operational-resilience-and-dr.md), the
[operational resilience architecture](../architecture/operational-resilience-and-dr.md),
[backup encryption and key management](../security/backup-encryption-and-key-management.md),
the [disaster-recovery threat model](../security/disaster-recovery-threat-model.md),
[recovery operator authorization](../security/recovery-operator-authorization.md),
[backup retention and disposal](../security/backup-retention-and-disposal.md), the
[disaster-recovery runbook](../operations/disaster-recovery-runbook.md), the
[backup and restore runbook](../operations/backup-restore-runbook.md), the
[service failure runbook](../operations/service-failure-runbook.md) and the
[disaster recovery demo](../demo/disaster-recovery-demo.md).

---

## Command reference

Every command below exists in the root `package.json`, and a CI test fails the
build if any documented command stops existing.

```bash
# Environment
pnpm env:check                                  # validate .env; names variables, never prints a value
pnpm env:init:local                             # create .env with generated secrets (refuses to overwrite)

# Demonstration
pnpm demo:start                                 # env check → Docker → infra → migrations → services
pnpm demo:status                                # what is listening
pnpm demo:verify                                # liveness, readiness and response-shape checks
pnpm demo:stop                                  # stop containers, keep data
pnpm demo:reset -- --yes                        # destroy local volumes, explicit confirmation
pnpm demo:evidence                              # synthetic screenshots into git-ignored .evidence/

# Infrastructure and migrations
pnpm infra:validate
pnpm infra:up
pnpm infra:check
pnpm infra:down
pnpm infra:reset -- --yes
pnpm db:deploy                                  # apply all five committed migration sets

# Reconciliation
pnpm reconcile:all                              # Ledger, Payments, Risk and Resilience together
pnpm ledger:reconcile
pnpm payments:reconcile
pnpm risk:reconcile
pnpm resilience:reconcile

# Recovery
pnpm dr:backup                                  # encrypted set; prints the exact next commands
pnpm dr:backup:verify -- --set <backup-set-id>  # or -- --latest
pnpm dr:backup:verify:negative -- --set <id>    # prove the refusals against a real set
pnpm dr:restore:verify -- --set <id>            # isolated restore into disposable databases
pnpm dr:drill                                   # the full deterministic drill

# Quality
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Operational detail lives in the [Phase 2 User Guide](../../USER_GUIDE.md) and the
[project README](../../README.md).

---

## How this release is validated

**GitHub Actions is the authoritative acceptance environment.** CI runs exactly
four jobs — `lint`, `typecheck`, `test` and `build`. The `test` job stands up real
PostgreSQL 17 and Redis in Docker, applies all five committed migration sets, and
then runs the tooling and documentation suites, shared contract tests, the SABCL
protocol, leakage, router, Redis-integration and strict-mode end-to-end suites,
Identity, Ledger, Payments, channel, Risk and Resilience unit and integration
tests, Gateway end-to-end tests, web component tests, Playwright functional and
accessibility runs, sanitized evidence capture, a real encrypted backup with
explicit-selection and refusal assertions, negative backup verification, isolated
restore verification, the full disaster-recovery drill, the Ledger, Payments and
Risk reconciliations, `reconcile:all`, and a cleanup step that fails the job if a
decrypted dump or a working directory survives. CI never uploads dumps, decrypted
files, `.env`, tokens or keys.

**The development machine used for this work has no working Docker engine.**
`docker version` reports the client, but the server returns a 500 for the API
route. That is stated plainly rather than papered over, and it determines what
each check's status label can honestly be:

| Check group                                                            | Status                               |
| ---------------------------------------------------------------------- | ------------------------------------ |
| `format:check`, `lint`, `typecheck`, `build`                           | PASS LOCALLY                         |
| Unit tests, tooling tests, contract tests, web component tests         | PASS LOCALLY                         |
| Integration, end-to-end, Playwright, backup, restore, drill, reconcile | PASS IN CI                           |
| Anything requiring a database, Redis or a browser on this machine      | NOT RUN LOCALLY — Docker unavailable |

No owner-machine clean-room claim is made for this release. Where a result is
claimed, the environment that produced it is named.

---

## Known limitations

These are the honest boundaries of what was built. Nothing above overrides them.

- **This is a hackathon prototype, not a production banking system.** Use
  synthetic data only. Never enter real money, real personal financial data, real
  banking credentials, production secrets or real cryptographic material.
- **Recovery figures are prototype measurements.** A drill reports a measured
  prototype recovery-point age and a measured prototype recovery duration from a
  run against local disposable infrastructure on one machine. Neither is a
  recovery-point objective, a recovery-time objective, or a guarantee.
- **Backup key custody is outside this repository.** The CLI reads a key from the
  environment; offsite storage, retention enforcement, and key rotation with
  re-encryption remain operational work that is not implemented here.
- **Redis is not backed up**, by design. Sessions do not survive a restore and
  customers sign in again.
- **Internal service trust rests on shared bootstrap tokens.** Internal tokens and
  per-source tokens are suitable for local development and CI only. Production
  needs rotated workload credentials, mTLS or platform workload identity, none of
  which is implemented.
- **SABCL padding hides size within a bucket and nothing more.** Timing, request
  frequency and order-of-magnitude payload size stay observable, and nothing in
  the layer protects a payload after the recipient decrypts it. Keys live in
  process memory from environment configuration; there is no HSM.
- **Risk rules are deterministic thresholds, not a trained model.** They are
  explainable and testable, and they require governance. They cannot replace a
  fraud model or a human investigator. IP geolocation is not implemented, so the
  rapid-region rule stays false.
- **Reconciliation runs on demand and repairs nothing.** A projection mismatch is
  reported, not corrected.
- **Ledger account statuses `FROZEN` and `CLOSED` exist in the model with no
  transitions**, so no status-based posting restriction is exercised. Multi-currency
  accounts are modelled but untested beyond `LKR`, and there is no foreign
  exchange.
- **Ledger idempotency records are retained for 24 hours with an `expiresAt`
  column but no scheduled purge**, so the table grows.
- **Deterministic lock ordering serialises journals that share an account**, which
  bounds throughput on a hot account. Acceptable at prototype scale.
- **Telco integration for USSD is not complete.** Provider authentication of the
  inbound webhook — IP allowlisting, mTLS or a shared provider secret — is the
  remaining work; today the route is reachable only through the Gateway and the
  internal-token boundary, and MSISDN binding plus PIN step-up carry the
  authorization.
- **Append-only protection is enforced by database triggers**, which a superuser
  migration could drop. Protecting migrations themselves is out of scope.
- **WebAuthn behaviour varies across authenticators and assistive technologies**
  beyond the tested Chromium virtual authenticator, and language quality in
  Sinhala and Tamil needs continued review by fluent speakers.
- **A same-origin script compromise** can observe in-memory form values and invoke
  credentialed requests; a compromised device or delivery channel can expose the
  fallback factors.
- **One local PostgreSQL container hosts all five databases.** Ownership is
  logically isolated by database and login role, but a shared host, container,
  network and instance is not a production isolation boundary, and local
  connections are not protected with TLS.

## Not included

The following are deliberately absent. This release does **not** provide:

- production multi-region disaster recovery
- continuous replication or streaming failover
- zero data loss
- a guaranteed production recovery-point or recovery-time objective
- protection against the loss of an entire cloud region or provider
- any compliance certification
- a trained fraud model
- production workforce identity
- external payment rails or any connection to a real financial network
- production messaging, notification delivery or real OTP delivery
- production observability and audit-integrity backends
- deployment manifests, queues or a production service mesh

Report suspected vulnerabilities privately as described in
[SECURITY.md](../../SECURITY.md). Contribution and branch practice is described in
[CONTRIBUTING.md](../../CONTRIBUTING.md). Architecture boundaries are documented
in the [architecture overview](../architecture/README.md), and every design choice
that constrained this release has an entry in
[docs/decisions](../decisions/0001-repository-and-branch-strategy.md).
