# Submission checklist

Work through this document before the AEGIS Shield Phase 2 submission is handed
over. Every item is something a person can check and either tick or fix; nothing
here is aspirational. The order matters: hygiene first, because a leaked secret
cannot be un-submitted; then documentation, commands, continuous integration,
demonstration readiness, security posture, and finally the honest-claims review
that governs everything said out loud.

The companion documents are the [final capability audit](./final-capability-audit.md),
the [final security review](./final-security-review.md), the
[final validation report](./FINAL_VALIDATION_REPORT.md), the
[final demo guide](./FINAL_DEMO_GUIDE.md) and the
[release notes](./RELEASE_NOTES.md). This checklist is the operational front
door to all five.

> **Stop before submitting.** The final security review records six confirmed
> release blockers in the inclusive-channel code, including an endpoint that
> moves money with no authentication. See
> [Release blockers](./final-security-review.md#release-blockers). The USSD and
> agent-cash channels must not be demonstrated as working, and the stack must
> not be exposed to any network.

## How to record status

Use only these labels. They exist because "it works" hides which machine it
worked on, and that distinction is the whole reason the acceptance story here is
CI-authoritative.

| Label                                  | Means                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `PASS LOCALLY`                         | Ran on the development machine and succeeded.                                  |
| `PASS IN CI`                           | Ran in GitHub Actions on the submitted commit and succeeded.                   |
| `NOT RUN LOCALLY — Docker unavailable` | Requires PostgreSQL or Redis; the development VM has no working Docker engine. |
| `FAIL`                                 | Ran and did not succeed.                                                       |
| `BLOCKED`                              | Could not be attempted, with the reason recorded.                              |

The development VM used to build this submission has a Docker client but no
working Docker server: `docker version` reports the client, and the server
returns a 500 for the `dockerDesktopLinuxEngine` API route. Everything that needs
a database therefore carries `NOT RUN LOCALLY — Docker unavailable` on that
machine and `PASS IN CI` from the workflow. No clean-room claim is made about the
owner's machine.

## 1. Repository hygiene

A submission is a public artifact. These checks answer one question: does the
repository contain anything that would be damaging to publish?

- [ ] `.env` is not tracked. `.gitignore` ignores `.env` and `.env.*` with a
      single exception for `.env.example`; confirm the exception is the only
      environment file in the index.
- [ ] `.env.example` contains placeholders only — no value that would work
      against any real system. Every secret-shaped entry is regenerated locally
      by `pnpm env:init:local`, never copied from a working deployment.
- [ ] No encrypted or decrypted backup material is tracked. `.dr-backups/`,
      `*.dump` and `*.dump.enc` are ignored; a decrypted dump is customer data in
      the clear and committing one would put the platform's contents into git
      history permanently.
- [ ] No key or certificate material is tracked: `*.pem`, `*.key`, `*.p12`,
      `*.pfx`, `*.crt`, `*.cer`, `certs/local/`.
- [ ] No demonstration evidence is tracked. `.evidence/` is ignored; screenshots
      wait for human review and are never committed.
- [ ] No `.env.replaced` file is tracked. `pnpm env:init:local -- --force` copies
      the previous file to `.env.replaced`, which is also git-ignored.
- [ ] No build output, `node_modules`, generated Prisma clients, coverage or
      Playwright reports are tracked.

Run this from the repository root; it must print nothing at all:

```bash
git ls-files -- ".env" ".env.*" ":(exclude).env.example" \
  "*.dump" "*.dump.enc" "*.pem" "*.key" "*.p12" "*.pfx" \
  "*.secret" "*.secrets" ".dr-backups" ".evidence"
```

Then confirm the ignore rules themselves are still present in
[.gitignore](../../.gitignore) — the check above only proves nothing slipped in
today, not that the guard rail still exists for tomorrow.

- [ ] The working tree is clean, or every remaining change is deliberate and
      described in the pull request.
- [ ] The submitted commit is on a branch with a traceable pull request, as
      described in [CONTRIBUTING.md](../../CONTRIBUTING.md).
- [ ] Nothing in the git history contains a real credential. If a credential was
      ever committed, it is rotated first and removed second — in that order.

## 2. Documentation completeness

Every document below must exist and must be reachable from a link a judge can
click. The CI test job asserts the six release documents exist, that every
documented `pnpm` command is a real script, and that every relative markdown link
resolves to a file that is present, so drift here is a build failure rather than
a discovery made during judging.

### Root documents

- [ ] [README.md](../../README.md) — problem, solution, implemented scope,
      structure, ports, installation, and the one-command demonstration.
- [ ] [USER_GUIDE.md](../../USER_GUIDE.md) — operational instructions for running
      and demonstrating the platform.
- [ ] [SECURITY.md](../../SECURITY.md) — supported status, responsible
      disclosure, and secrets handling.
- [ ] [CONTRIBUTING.md](../../CONTRIBUTING.md) — branch, review and traceability
      expectations.

### Release documents

- [ ] [FINAL_DEMO_GUIDE.md](./FINAL_DEMO_GUIDE.md) — the walkthrough, including
      every service port from 3000 through 4106.
- [ ] [SUBMISSION_CHECKLIST.md](./SUBMISSION_CHECKLIST.md) — this document.
- [ ] [FINAL_VALIDATION_REPORT.md](./FINAL_VALIDATION_REPORT.md) — what ran,
      where it ran, and the result, using the status labels above.
- [ ] [RELEASE_NOTES.md](./RELEASE_NOTES.md) — what shipped across prompts 00-11.
- [ ] [final-capability-audit.md](./final-capability-audit.md) — capability by
      capability, with the evidence for each.
- [ ] [final-security-review.md](./final-security-review.md) — the security
      review whose checks section 6 works through.

### Architecture and decisions

- [ ] [Architecture overview](../architecture/README.md) — boundaries, the full
      port table, data ownership.
- [ ] [Threat detection and controls](../architecture/threat-detection-and-controls.md)
- [ ] [Operational resilience and disaster recovery](../architecture/operational-resilience-and-dr.md)
- [ ] Architecture Decision Records 0001 through 0011:
      [0001](../decisions/0001-repository-and-branch-strategy.md),
      [0002](../decisions/0002-monorepo-tooling.md),
      [0003](../decisions/0003-local-data-infrastructure.md),
      [0004](../decisions/0004-identity-and-session-authentication.md),
      [0005](../decisions/0005-authentication-user-experience.md),
      [0006](../decisions/0006-accounts-and-double-entry-ledger.md),
      [0007](../decisions/0007-customer-transaction-history.md),
      [0008](../decisions/0008-secure-customer-transfers.md),
      [0009](../decisions/0009-sabcl-privacy-and-secure-routing.md),
      [0010](../decisions/0010-threat-detection-and-automated-controls.md),
      [0011](../decisions/0011-operational-resilience-and-dr.md).

### Security documents

- [ ] Authentication and sessions:
      [authentication threat model](../security/authentication-threat-model.md).
- [ ] Ledger and transfers:
      [ledger integrity model](../security/ledger-integrity-model.md),
      [fund transfer model](../security/fund-transfer-model.md),
      [transfer threat model](../security/transfer-threat-model.md),
      [payment idempotency and recovery](../security/payment-idempotency-and-recovery.md),
      [transaction history privacy](../security/transaction-history-privacy.md).
- [ ] Inclusive channels:
      [inclusive channels threat model](../security/inclusive-channels-threat-model.md).
- [ ] SABCL:
      [protocol](../security/sabcl-protocol.md),
      [threat model](../security/sabcl-threat-model.md),
      [metadata leakage](../security/sabcl-metadata-leakage.md),
      [replay and expiry](../security/sabcl-replay-and-expiry.md),
      [key management](../security/sabcl-key-management.md),
      [route provisioning](../security/sabcl-route-provisioning.md),
      [runbook](../security/sabcl-runbook.md).
- [ ] Risk and controls:
      [threat detection threat model](../security/threat-detection-threat-model.md),
      [risk event contract](../security/risk-event-contract.md),
      [risk rule catalogue](../security/risk-rule-catalogue.md),
      [automated control policy](../security/automated-control-policy.md),
      [risk failure policy](../security/risk-failure-policy.md),
      [risk privacy and retention](../security/risk-privacy-and-retention.md),
      [risk reconciliation guide](../security/risk-reconciliation-guide.md),
      [operator authorization model](../security/operator-authorization-model.md),
      [incident response runbook](../security/incident-response-runbook.md).
- [ ] Resilience:
      [disaster recovery threat model](../security/disaster-recovery-threat-model.md),
      [backup encryption and key management](../security/backup-encryption-and-key-management.md),
      [backup retention and disposal](../security/backup-retention-and-disposal.md),
      [recovery operator authorization](../security/recovery-operator-authorization.md).

### Operations runbooks

- [ ] [Backup and restore runbook](../operations/backup-restore-runbook.md)
- [ ] [Disaster recovery runbook](../operations/disaster-recovery-runbook.md)
- [ ] [Service failure runbook](../operations/service-failure-runbook.md)

### Demonstration plans

- [ ] [Demonstration index](../demo/README.md) and the seven scenario documents:
      [authentication](../demo/authentication-demo.md),
      [accounts and ledger](../demo/accounts-ledger-demo.md),
      [dashboard and transactions](../demo/dashboard-transactions-demo.md),
      [customer transfer](../demo/customer-transfer-demo.md),
      [SABCL routing](../demo/sabcl-routing-demo.md),
      [risk controls](../demo/risk-controls-demo.md),
      [disaster recovery](../demo/disaster-recovery-demo.md).

### Component documentation

- [ ] [infra/README.md](../../infra/README.md) — ports, volumes, roles,
      initialization and troubleshooting.
- [ ] [packages/README.md](../../packages/README.md),
      [packages/sabcl/README.md](../../packages/sabcl/README.md).
- [ ] [services/README.md](../../services/README.md) and one README per service:
      [identity](../../services/identity/README.md),
      [ledger](../../services/ledger/README.md),
      [payments](../../services/payments/README.md),
      [risk](../../services/risk/README.md),
      [resilience](../../services/resilience/README.md),
      [sabcl-router](../../services/sabcl-router/README.md).
- [ ] [apps/api-gateway/README.md](../../apps/api-gateway/README.md),
      [apps/web/README.md](../../apps/web/README.md).

### Documentation quality gates

- [ ] No document contains a real credential, a real phone number, a real
      account reference or a screenshot with any of those in it.
- [ ] No document contains a placeholder marker. The CI job fails the release
      documents if one appears.
- [ ] No document says a shipped capability is still coming. QR, USSD and agent
      cash shipped in prompt 08; SABCL in 09; threat detection in 10; encrypted
      backup, isolated restore verification and recovery drills in 11.
- [ ] Every document that lists the stack lists all of it — five databases, and
      ports 3000, 4000, 4101, 4102, 4103, 4104, 4105 and 4106.

## 3. Command verification

Every command below exists as a script in [package.json](../../package.json).
Tick the ones you actually ran and record where they ran. The "Docker" column
says whether PostgreSQL and Redis must be up; on a machine without a working
Docker engine those rows are `NOT RUN LOCALLY — Docker unavailable`, not `FAIL`.

### Environment and setup

| Command               | What it proves                                                                                                                                                                                                                                                                                                      | Docker |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `pnpm env:init:local` | Creates `.env` from `.env.example` with freshly generated secrets. Refuses to overwrite an existing file; `pnpm env:init:local -- --force` replaces it and keeps a git-ignored copy.                                                                                                                                | no     |
| `pnpm env:check`      | Validates the environment: required variables, port collisions, PostgreSQL and Redis URL shape, that each service URL names the database and login role it claims, and that `FIELD_ENCRYPTION_KEY` and `DR_BACKUP_ENCRYPTION_KEY` decode to exactly 32 non-zero bytes. It names variables and never prints a value. | no     |
| `pnpm sabcl:keys`     | Generates X25519 and Ed25519 identities and the route secret. Needed only when `SABCL_MODE` is not `off`.                                                                                                                                                                                                           | no     |

- [ ] `pnpm env:check` exits zero and prints `configuration is complete and well formed`.
- [ ] No value appeared in the output of either environment command.

### Infrastructure and migrations

| Command                                | What it proves                                                            | Docker |
| -------------------------------------- | ------------------------------------------------------------------------- | ------ |
| `pnpm infra:validate`                  | The compose configuration is well formed.                                 | no     |
| `pnpm infra:up`                        | PostgreSQL 17 and authenticated Redis start.                              | yes    |
| `pnpm infra:check`                     | Readiness, the five databases, their least-privilege roles and ownership. | yes    |
| `pnpm infra:status`, `pnpm infra:logs` | What is running, and why it is not.                                       | yes    |
| `pnpm db:generate`                     | Prisma clients for Identity, Ledger, Payments, Risk and Resilience.       | no     |
| `pnpm db:deploy`                       | Applies all five committed migration sets.                                | yes    |
| `pnpm infra:down`                      | Stops containers and keeps named volumes.                                 | yes    |
| `pnpm infra:reset -- --yes`            | Destroys local volumes, on explicit confirmation only.                    | yes    |

### Demonstration

| Command                    | What it proves                                                                                                                                                                                                                                    | Docker |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `pnpm demo:start`          | Environment check, Docker engine check, infrastructure, migrations, then Identity, Ledger, the SABCL router when configured, Payments, Risk, Resilience, Gateway and Web — each waited on by polling its readiness endpoint rather than sleeping. | yes    |
| `pnpm demo:status`         | A name, port and state table for every service.                                                                                                                                                                                                   | yes    |
| `pnpm demo:verify`         | Liveness, readiness and response-shape checks.                                                                                                                                                                                                    | yes    |
| `pnpm demo:stop`           | Stops containers and preserves data.                                                                                                                                                                                                              | yes    |
| `pnpm demo:reset -- --yes` | Destroys local volumes, on explicit confirmation only.                                                                                                                                                                                            | yes    |
| `pnpm demo:evidence`       | Synthetic screenshots into the git-ignored `.evidence/`.                                                                                                                                                                                          | yes    |

### Reconciliation

| Command                     | What it proves                                                                                                                                                                                          | Docker |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `pnpm reconcile:all`        | Runs the Ledger, Payments, Risk and Resilience reconciliations in sequence, preserves each individual result, prints a sanitized summary and returns non-zero if any of the four disagrees with itself. | yes    |
| `pnpm ledger:reconcile`     | Journals, postings and balance projections agree.                                                                                                                                                       | yes    |
| `pnpm payments:reconcile`   | Transfer intents and lifecycle events agree with the ledger.                                                                                                                                            | yes    |
| `pnpm risk:reconcile`       | Control and incident state, recomputed through the running service behind its internal-token boundary.                                                                                                  | yes    |
| `pnpm resilience:reconcile` | Drill evidence and backup-set registry consistency.                                                                                                                                                     | yes    |

### Disaster recovery

The set must always be named. A bare `pnpm dr:backup:verify` or
`pnpm dr:restore:verify` fails rather than guessing which bytes to examine, and
`--latest` chooses by the manifest's `createdAt` rather than by directory name —
two sets sharing the newest timestamp is an error, not a coin toss.

| Command                                                   | What it proves                                                                                                                                                                                                                                                        | Docker |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `pnpm dr:backup`                                          | An AES-256-GCM encrypted set of the identity, ledger, payments, risk and resilience databases. It prints the exact next commands with the new identifier already filled in.                                                                                           | yes    |
| `pnpm dr:backup:verify -- --set <backup-set-id>`          | Checksums and authenticity, verified before anything is decrypted. `-- --latest` is available when the operator asks for it.                                                                                                                                          | yes    |
| `pnpm dr:backup:verify:negative -- --set <backup-set-id>` | Against a copy of a real set: wrong key, tampered ciphertext, missing file, incomplete set, duplicate service, path-traversal file name, unsupported manifest version, unsupported algorithm and symlink escape are each refused. The original set is never modified. | yes    |
| `pnpm dr:restore:verify -- --set <backup-set-id>`         | An isolated restore into freshly created `aegis_verify_*` databases with generated names, checked against the live database names first and dropped afterwards. No flag can redirect it onto a live database.                                                         | yes    |
| `pnpm dr:drill`                                           | The full deterministic drill: backup, verify, isolated restore, the four reconciliations, and an append-only transition-validated evidence trail recording a measured prototype recovery-point age and a measured prototype recovery duration.                        | yes    |

### Quality gates

| Command             | What it proves                                                      | Docker |
| ------------------- | ------------------------------------------------------------------- | ------ |
| `pnpm format:check` | Formatting is consistent.                                           | no     |
| `pnpm lint`         | Every workspace lints clean.                                        | no     |
| `pnpm typecheck`    | Every workspace typechecks.                                         | no     |
| `pnpm build`        | Every application and service builds.                               | no     |
| `pnpm test`         | Tooling tests under `infra/scripts` plus every workspace test task. | partly |
| `pnpm clean`        | Removes generated framework and Turborepo output.                   | no     |

### Targeted suites a judge may ask for

- [ ] Authentication: `pnpm auth:test`, `pnpm auth:test:e2e`
- [ ] Ledger and history: `pnpm ledger:test`, `pnpm ledger:test:integration`,
      `pnpm ledger:test:e2e`, `pnpm transactions:test:integration`,
      `pnpm transactions:test:e2e`
- [ ] Payments: `pnpm payments:test`, `pnpm payments:test:startup`,
      `pnpm payments:test:integration`, `pnpm payments:test:e2e`,
      `pnpm payments:recover`
- [ ] Inclusive channels: `pnpm channels:test`, `pnpm channels:test:qr`,
      `pnpm channels:test:ussd`, `pnpm channels:test:agent`
- [ ] SABCL: `pnpm sabcl:test`, `pnpm sabcl:test:leakage`,
      `pnpm sabcl:test:router`, `pnpm sabcl:test:integration`,
      `pnpm sabcl:test:e2e`
- [ ] Risk: `pnpm risk:test`, `pnpm risk:test:integration`, `pnpm risk:recover`
- [ ] Resilience: `pnpm resilience:test`, `pnpm resilience:test:integration`
- [ ] Web: `pnpm web:test`, `pnpm web:e2e:install`, `pnpm web:test:e2e`,
      `pnpm web:test:a11y`
- [ ] Development stack: `pnpm dev`, `pnpm stack:start`

Only the unit-level suites run without Docker. Everything with `integration`,
`e2e`, `reconcile` or `dr:` in its name needs PostgreSQL and Redis and is
authoritative in GitHub Actions.

## 4. Continuous integration state

Docker-dependent acceptance is performed by GitHub Actions and is authoritative
there. Open the workflow run for the submitted commit before ticking anything in
this section.

- [ ] The workflow file is [.github/workflows/ci.yml](../../.github/workflows/ci.yml)
      and defines exactly four jobs: `lint`, `typecheck`, `test`, `build`.
- [ ] All four jobs are green on the submitted commit — not on an older commit,
      and not on a different branch.
- [ ] The run was triggered by the pull request or the push to `main` that
      carries the submitted commit.

The `test` job is where the evidence lives. It brings up real PostgreSQL 17 and
Redis, installs the matching PostgreSQL 17 client tools so the recovery tooling
is not run against a mismatched `pg_dump`, applies all five committed migration
sets, and then runs the suites. Read these named steps in the log:

- [ ] **Validate documented commands and release documents** — proves every
      documented command exists, every release document is present, and no
      markdown link points at a missing file.
- [ ] **Test infrastructure, environment, demo, reconcile and evidence tooling** —
      the tooling under `infra/scripts` is unit-tested without a Docker engine.
- [ ] **Test SABCL metadata leakage against seeded sensitive values** — proves the
      routing envelope does not carry the values seeded into the payload.
- [ ] **Test strict-mode encrypted end-to-end journey through the router** — a full
      journey over real sockets with no fallback available.
- [ ] **Test QR signing, tampering, expiry and replay**, **Test USSD session state,
      expiry and webhook security**, **Test agent cash authorization, limits and
      idempotency** — the three inclusive channels.
- [ ] **Test real Gateway Identity Payments Ledger transfers end to end** — the
      transfer path across four real services.
- [ ] **Test transfer accessibility including EN SI TA and mobile states** — the
      Playwright accessibility run.
- [ ] **Capture and sanitize demonstration evidence** — every captured page is
      scanned for one-time codes, PINs, cookies, tokens, connection strings and
      full account references, and the run fails if any is rendered. The images
      themselves are never uploaded.
- [ ] **Create an encrypted backup set and verify it by explicit identifier** — the
      set identifier is read from the backup's own output and carried forward.
- [ ] **Refuse a bare, ambiguous or unknown backup selection** — a bare verify, an
      unknown identifier and a path-shaped identifier must each fail, while
      `-- --latest` still works.
- [ ] **Refuse tampered, wrong-key, incomplete and unsafe backup sets** — the
      negative suite against a real set.
- [ ] **Verify an isolated restore into disposable databases** — restore into
      generated database names, never a live one.
- [ ] **Run the deterministic disaster-recovery drill** — the whole drill,
      including the four reconciliations and the recorded measurements.
- [ ] **Aggregate reconciliation across Ledger, Payments, Risk and Resilience** —
      the aggregate command agrees with the four individual runs.
- [ ] **Remove backup working directory and assert no plaintext remains** — runs on
      every outcome and fails the job if a decrypted dump survived or a working
      directory was left behind.

Also confirm what CI does _not_ do:

- [ ] No dump, decrypted file, `.env`, token or key is uploaded as an artifact.
      The only artifact is the Playwright report, and only on failure.
- [ ] Every credential in the workflow is an obvious throwaway, marked
      `ci-only-` or `CI_ONLY_`. The DR key is the base64 of an ASCII string
      chosen so the real AES-256-GCM path is exercised while protecting nothing.
- [ ] `SABCL_MODE` is deliberately not set job-wide, with the reason recorded in
      a comment; strict mode is exercised by the suites that build their own
      keyring from deterministic fixtures.

## 5. Demonstration readiness

Rehearse on the machine that will be used for the demonstration, not on the one
that built it.

- [ ] Prerequisites present: Git, Node.js `>=22.12` as required by `engines` in
      `package.json` with the Node.js 22 line selected by `.nvmrc`, pnpm
      `11.8.0` as pinned by `packageManager`, and a working Docker engine with
      Compose v2.
- [ ] Ports 3000, 4000, 4101, 4102, 4103, 4104, 4105, 4106, 5432 and 6379 are
      free.
- [ ] `pnpm install` completes against the single root `pnpm-lock.yaml`.
- [ ] `pnpm env:init:local` created `.env`, and `pnpm env:check` reports the
      configuration complete.
- [ ] `pnpm build` has been run. `demo:start` refuses to launch a service whose
      build output is missing and tells you to build.
- [ ] `pnpm demo:start` reaches the service table with every row `ready`, prints
      the local web address and holds the stack open.
- [ ] `pnpm demo:verify` reports that every service answered and every response
      matched its documented shape. It checks liveness for every service,
      readiness for the Gateway and Resilience, and refuses a health document
      that omits its required fields, discloses a forbidden key, or contains a
      PostgreSQL or Redis connection string anywhere in the body.
- [ ] `pnpm demo:status` agrees with `demo:verify`.
- [ ] Ctrl+C stops every child in reverse start order and reports that local data
      was not touched.
- [ ] The SABCL row reads `skipped` when `SABCL_MODE` is `off`, which is how the
      repository ships. If the demonstration includes the encrypted path, keys
      were generated with `pnpm sabcl:keys` and `SABCL_MODE` was set to `strict`
      before starting.
- [ ] The customer journeys in the [final demo guide](./FINAL_DEMO_GUIDE.md) were
      rehearsed end to end at least once, in English and in at least one of
      Sinhala or Tamil.
- [ ] The security-operator console at `/security-ops` and the recovery console
      at `/security-ops/resilience` both open and are reachable with a
      demonstration operator session.
- [ ] `pnpm reconcile:all` passes after the rehearsal, so the demonstration does
      not begin from an inconsistent state.
- [ ] If screenshots are being submitted, `pnpm demo:evidence` was run and every
      image was opened and reviewed by a person. The automated scan covers page
      text only; an image can show something the text scan cannot see, and
      `.evidence/` is git-ignored precisely so that review happens before
      anything is shared.
- [ ] All demonstration data is synthetic. No real money, no real identity, no
      real credential.

## 6. Security posture

These are the checks the [final security review](./final-security-review.md)
records. Re-confirm them against the submitted commit rather than trusting an
earlier reading.

### Boundaries

- [ ] The API Gateway is the only public HTTP surface and binds to `127.0.0.1`.
- [ ] Identity, Ledger, the SABCL router, Payments, Risk and Resilience each
      default their bind host to `127.0.0.1` and none of them enables CORS. A
      browser cannot reach them at all.
- [ ] The Gateway's CORS origin is the single local web origin; it is not a
      wildcard and it does not read an origin from a request header.
- [ ] Each of the five databases has one least-privilege login role and no
      service reads another service's tables.

### Authentication and sessions

- [ ] PINs are hashed with Argon2id and the parameters are recorded with the
      hash, so a future parameter change is detectable rather than silent.
- [ ] One-time codes are stored hashed, never in the clear.
- [ ] Sessions are opaque, revocable and held in Redis; the raw session value
      never appears in a response body or in browser storage.
- [ ] The session cookie is HttpOnly and the double-submit CSRF cookie is
      deliberately readable — that asymmetry is the mechanism, not an oversight.
      Both are `Secure` when `NODE_ENV` is `production`.
- [ ] Every state-changing request requires the CSRF header, and the comparison
      is timing-safe.
- [ ] Security-operator sessions are separate from customer sessions, with their
      own cookies, their own role check on every call, and an operator audit
      trail for every mutation.

### Service-to-service trust

- [ ] Internal calls carry an internal token and every guard compares it in
      constant time.
- [ ] Risk accepts events only from a per-source token, so a compromised caller
      cannot impersonate another subsystem.
- [ ] Controls issued by Risk are enforced independently at the Gateway, at
      Payments and at Identity, so bypassing one enforcement point does not
      bypass the control.

### SABCL

- [ ] The blind router holds no key that opens a payload; it resolves an opaque
      route token to an allowlisted destination and forwards bytes.
- [ ] Customer identifiers, account identifiers, amounts, recipient references,
      endpoint paths, operation names and PIN authorisation are absent from the
      routing envelope, and the leakage suite asserts it against seeded values.
- [ ] Replay protection is Redis-backed, the hop budget is bounded, and padding
      buckets hide exact payload size within a bucket — and nothing more, which
      the metadata leakage analysis states plainly.
- [ ] `compatible` mode documents a fallback and is refused when
      `NODE_ENV=production`; `strict` never falls back.

### Money handling

- [ ] Money is integer minor units everywhere — `BIGINT` in PostgreSQL, `BigInt`
      in TypeScript, decimal strings on the wire. No JavaScript number holds an
      amount.
- [ ] Journals and postings are immutable and append-only, enforced by database
      triggers, and journal balance is enforced by deferred constraint triggers.
- [ ] Ledger is the sole balance authority. Payments asks; it does not decide.
- [ ] Transfer confirmation is idempotent, and a replayed confirmation with a
      different payload is a conflict rather than a second transfer.

### Backups and recovery

- [ ] Backup and restore are operator command-line tooling. No HTTP route runs a
      backup or a restore, accepts a filesystem path, accepts a connection string
      or executes a shell command — a console button that shelled out would be
      remote command execution behind a login.
- [ ] Checksums are verified before anything is decrypted, so a corrupted or
      wrong-key set is rejected before it can be parsed.
- [ ] A restore target is always a freshly created database with a generated
      name, checked against the live database names, and dropped afterwards.
- [ ] Decrypted dumps are removed as soon as they are consumed, and the tooling
      cleans up in a `finally` so a mid-restore failure leaves no plaintext.
- [ ] Redis is deliberately not backed up: it holds recreatable cache, replay and
      velocity state, so after a restore customers sign in again. That is a
      stated design decision, not an omission.
- [ ] Recovery evidence is visible only to a signed-in security operator, because
      it is an accurate map of what is worth stealing and when the platform is
      least able to recover.

### Output discipline

- [ ] No tool prints a secret. The environment checker names variables and never
      values; the demo orchestrator redacts by variable name and strips URL
      userinfo, including a Redis URL with an empty username; the reconciliation
      aggregator copies only allow-listed counter fields out of each result.
- [ ] Health documents carry no connection string, token, password or stack
      trace, and `demo:verify` fails if one appears.
- [ ] Error responses do not leak internal hostnames or upstream bodies.

## 7. Honest-claims review

Read this list aloud against every slide, README line, demo script and answer
before submission. If a sentence anywhere in the submission implies one of these,
fix the sentence.

This project does **not** provide, and must never be described as providing:

- [ ] production multi-region disaster recovery
- [ ] continuous replication
- [ ] zero data loss
- [ ] compliance certification of any kind
- [ ] a guaranteed production recovery-point objective or recovery-time objective
- [ ] protection against the loss of a cloud region or a cloud provider
- [ ] a trained fraud model
- [ ] production workforce identity
- [ ] external payment rails
- [ ] production messaging or real one-time-code delivery

And confirm the positive framing is right:

- [ ] Recovery figures are described as a **measured prototype recovery-point
      age** and a **measured prototype recovery duration**, from a drill against
      local disposable infrastructure. They are never called an RPO or an RTO.
- [ ] The platform is described as a hackathon prototype throughout, never as a
      production banking system.
- [ ] Acceptance is described as CI-authoritative. Docker-independent checks ran
      locally; Docker-dependent acceptance is performed by GitHub Actions.
- [ ] No owner-machine clean-room claim appears anywhere.
- [ ] Every demonstration is stated to use synthetic data only.
- [ ] Padding is described as hiding exact payload size within a bucket, not as
      hiding traffic patterns.
- [ ] Nothing claims protection for a payload after the recipient has decrypted
      it.

## 8. What to say if asked

Short, accurate answers. Each one concedes the real limit first and then says
what was actually built, because that ordering is what makes the second half
believable.

**"Is this production ready?"**
No. It is a hackathon prototype built for Duothan 6.0 Phase 2. The security
design, the double-entry ledger, the metadata-protected routing and the recovery
tooling are real and tested, but there is no production operations story behind
them: no managed key custody, no offsite immutable storage, no compliance
certification, and no support commitment.

**"What is your RPO and RTO?"**
There isn't one, and nothing here should be read as one. What exists is a
measured prototype recovery-point age and a measured prototype recovery duration,
taken from a deterministic drill that backs up five local databases, verifies the
set, restores it into disposable databases and reconciles the result. Those are
measurements of that drill on local infrastructure, not guarantees about a
production system.

**"Could you survive losing a region?"**
No. There is no multi-region deployment and no continuous replication. Backup
sets are written to the operator's machine. Losing the region — or the provider —
loses the platform. That is a deliberate scope boundary, not something that was
attempted and missed.

**"Is the fraud detection real?"**
The rules are real and deterministic: integer weights, versioned reasons, and a
persisted explanation for every assessment, so any score can be reconstructed
afterwards. It is not a trained model, and it was not evaluated against a real
fraud dataset. It demonstrates explainable, auditable control enforcement rather
than detection accuracy.

**"Can the router read the traffic?"**
No. It resolves an opaque route token to an allowlisted destination and forwards
the envelope; it holds no key that opens the payload. What it can see is
documented rather than glossed over: envelope size within a padding bucket,
timing, and the fact that a call happened. It cannot see who, how much, to whom,
or which operation.

**"Why isn't Redis backed up?"**
Because everything in it is recreatable — session, challenge, replay and velocity
state. Backing it up would extend the blast radius of a stolen backup set without
improving recovery. After a restore, customers sign in again.

**"Did you run all of this yourself?"**
The Docker-independent checks ran locally: formatting, lint, typecheck, build,
unit tests, tooling tests, contract tests and web component tests. Everything
that needs PostgreSQL and Redis — integration suites, browser and accessibility
runs, backup, negative backup, isolated restore, the disaster-recovery drill and
all four reconciliations — runs in GitHub Actions, and CI is the authoritative
result. The development machine has no working Docker engine, so no clean-room
claim is made about it.

**"What would you build next?"**
Backup key custody and offsite immutable storage, production workforce identity
with MFA for the operator consoles, real one-time-code delivery, governed
evaluation of a fraud model, and observability with audit integrity. Those are
the gaps between this prototype and something a bank could run.

## 9. Final sign-off

- [ ] Sections 1 through 7 are complete, with a status recorded for every item
      that was run.
- [ ] The [final validation report](./FINAL_VALIDATION_REPORT.md) matches what
      this checklist recorded — same commands, same labels, no optimistic
      rounding.
- [ ] The four CI jobs are green on the exact commit being submitted.
- [ ] The submission links point at that commit, not at a branch that has moved
      since.
- [ ] One person other than the author has read section 7 against the submitted
      material and agrees that nothing overstates what was built.
