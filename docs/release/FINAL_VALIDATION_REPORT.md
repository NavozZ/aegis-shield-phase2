# Final validation report

This is the record of what was actually run against AEGIS Shield Phase 2, on
which machine it ran, and what the result was. It is deliberately narrow: it
does not argue that the platform is good, it says what was executed and what
exited zero.

Two things are kept apart throughout, and are never blurred:

- **Local Docker validation was not performed.** The development VM has a Docker
  client but no working Docker server, so nothing that needs PostgreSQL or Redis
  ran on it. No clean-room claim is made about the owner's machine.
- **Docker-dependent validation is performed by GitHub Actions, and GitHub
  Actions is authoritative for it.** The workflow is
  [.github/workflows/ci.yml](../../.github/workflows/ci.yml).

If a claim in any other document conflicts with a row in this one, this one is
the record of what ran.

## How to read the status labels

Only these five labels are used. They exist because "it works" hides which
machine it worked on, and that distinction is the entire acceptance story here.

| Label                                  | Means                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `PASS LOCALLY`                         | Ran on the development machine and succeeded.                                  |
| `PASS IN CI`                           | Ran in GitHub Actions on the submitted commit and succeeded.                   |
| `NOT RUN LOCALLY — Docker unavailable` | Requires PostgreSQL or Redis; the development VM has no working Docker engine. |
| `FAIL`                                 | Ran and did not succeed.                                                       |
| `BLOCKED`                              | Could not be attempted, with the reason recorded.                              |

A row never carries two labels. A check that ran locally and also runs in CI is
recorded in both tables, once each, so that a green tick in one place can never
be read as evidence about the other.

## 1. Local Docker: not run

`docker version` on the development VM prints the client block and then fails on
the server call. The server error, quoted exactly once:

```text
request returned 500 Internal Server Error for API route and version http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.55/version, check if the server supports the requested API version
```

The client reports version 29.6.2 with context `desktop-linux`; the engine behind
that context does not answer. Nothing in this repository can work around that:
`docker-compose.yml` declares `postgres:17.10-alpine` and `redis:8.6.5-alpine`,
and both need a running engine.

Two consequences, stated plainly:

- **No owner-machine clean-room validation is claimed.** Not for the demo, not
  for the drill, not for the reconciliations. Any statement that the full stack
  was proven end to end on the development VM would be false.
- **Every check that touches a database, a cache, a browser or a backup set
  carries `NOT RUN LOCALLY — Docker unavailable` below**, and its evidence comes
  from CI wherever CI runs the same check.

The failure mode was confirmed rather than assumed. `pnpm infra:check` was
started on the development VM and did not complete; it was terminated after 120
seconds of waiting on the dead engine. `pnpm infra:validate` does pass locally,
and that is not a contradiction: it parses and validates the Compose
configuration and the declarations inside it, and never asks the engine to run
anything.

These are the commands that were therefore not run locally. Every one of them is
real and exists in `package.json`; the point of listing them is that a reader
should not infer from their documentation that they were demonstrated here.

Most of them CI invokes verbatim, and section 5 names the step for each. Four do
not appear in the workflow at all, and pretending otherwise would be the same
kind of overstatement this section exists to avoid. `pnpm demo:start`,
`pnpm demo:verify` and `pnpm demo:evidence` are local operator commands: CI
starts the services it needs directly inside the steps that use them, and covers
evidence capture and its sanitization through the web package's own
`test:evidence` script rather than through the demonstration wrapper.
`pnpm db:deploy` is a convenience that chains the five per-service deployments;
CI applies the same five committed migration sets one at a time, beginning with
`pnpm db:deploy:identity`, so a failure names the service it belongs to.

| Command                                        | Status                                 | Why it needs Docker                                           |
| ---------------------------------------------- | -------------------------------------- | ------------------------------------------------------------- |
| `pnpm infra:up` / `pnpm infra:check`           | `NOT RUN LOCALLY — Docker unavailable` | Starts and health-checks the PostgreSQL and Redis containers. |
| `pnpm db:deploy`                               | `NOT RUN LOCALLY — Docker unavailable` | Applies five migration sets to a live PostgreSQL.             |
| `pnpm demo:start` / `pnpm demo:verify`         | `NOT RUN LOCALLY — Docker unavailable` | Brings up infrastructure, then probes service health.         |
| `pnpm reconcile:all`                           | `NOT RUN LOCALLY — Docker unavailable` | Reads live databases and calls running services.              |
| `pnpm dr:backup`                               | `NOT RUN LOCALLY — Docker unavailable` | Dumps the five databases through `pg_dump`.                   |
| `pnpm dr:backup:verify -- --set <id>`          | `NOT RUN LOCALLY — Docker unavailable` | Verifies a backup set that only a live database can produce.  |
| `pnpm dr:backup:verify:negative -- --set <id>` | `NOT RUN LOCALLY — Docker unavailable` | Runs its refusals against a real set.                         |
| `pnpm dr:restore:verify -- --set <id>`         | `NOT RUN LOCALLY — Docker unavailable` | Creates and drops disposable databases.                       |
| `pnpm dr:drill`                                | `NOT RUN LOCALLY — Docker unavailable` | The whole recovery sequence against live infrastructure.      |
| `pnpm demo:evidence`                           | `NOT RUN LOCALLY — Docker unavailable` | Drives a browser against the running stack.                   |

## 2. The machine the local checks ran on

Recording this matters because a local pass on one toolchain is not a pass on
another.

| Property         | Development VM                  | CI runner                                    |
| ---------------- | ------------------------------- | -------------------------------------------- |
| Operating system | Windows Server 2025 Standard    | `ubuntu-latest`                              |
| Node.js          | v24.18.1                        | Pinned by `.nvmrc`, which contains `22`      |
| pnpm             | 11.8.0                          | 11.8.0, from the `packageManager` field      |
| Docker engine    | Not working (see section 1)     | Working; PostgreSQL 17 and Redis are started |
| Branch           | `chore/p12-final-audit-release` | The submitted pull request or push to `main` |

The Node.js major version differs. The repository requires `>=22.12` and CI pins
the `.nvmrc` version, so a defect that only appears on Node 22 would be caught in
CI and not locally, and a defect that only appears on Node 24 would be caught
locally and not in CI. Neither run supersedes the other; CI is authoritative for
acceptance because it is the environment with a database.

## 3. Local check results

Run against the working tree on the branch above. Reproduce any row by
running the command in its cell from the repository root.

| Check                               | Command                                            | Status         | Evidence                                                                                                                                                                                                                                                                           |
| ----------------------------------- | -------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency install, lockfile frozen | `pnpm install --frozen-lockfile`                   | `PASS LOCALLY` | 11 workspace projects, "Already up to date", 734 ms; the lockfile was not rewritten.                                                                                                                                                                                               |
| Formatting                          | `pnpm format:check`                                | `FAIL`         | Three files reported: `.github/workflows/ci.yml`, plus the untracked `audit-findings.json` and `audit-live.json`. See the note below; none is a source defect.                                                                                                                     |
| Lint                                | `pnpm lint`                                        | `PASS LOCALLY` | Turbo: 10 tasks, 10 successful.                                                                                                                                                                                                                                                    |
| Typecheck                           | `pnpm typecheck`                                   | `PASS LOCALLY` | Turbo: 10 tasks, 10 successful.                                                                                                                                                                                                                                                    |
| Build                               | `pnpm build`                                       | `PASS LOCALLY` | Turbo: 10 tasks, 10 successful, including the Next.js production build.                                                                                                                                                                                                            |
| Root tooling unit tests             | `node --test "infra/scripts/*.test.mjs"`           | `PASS LOCALLY` | 82 tests, 82 passed. An earlier run of the same command reported 79 of 82 while the release documents were still being written; see the note below.                                                                                                                                |
| Workspace unit tests                | `turbo run test --force`                           | `PASS LOCALLY` | 12 tasks (10 test tasks plus 2 dependency builds), all successful. One earlier run failed `@aegis/api-gateway` under parallel load; it passed on a forced re-run and on three consecutive isolated runs of 123 tests each, and was not reproduced. Recorded rather than dismissed. |
| Infrastructure tooling tests        | `node --test infra/scripts/infra.test.mjs`         | `PASS LOCALLY` | 8 tests, 8 passed.                                                                                                                                                                                                                                                                 |
| Environment tooling tests           | `node --test infra/scripts/env.test.mjs`           | `PASS LOCALLY` | 17 tests, 17 passed.                                                                                                                                                                                                                                                               |
| Demo tooling tests                  | `node --test infra/scripts/demo.test.mjs`          | `PASS LOCALLY` | 24 tests, 24 passed.                                                                                                                                                                                                                                                               |
| Reconciliation tooling tests        | `node --test infra/scripts/reconcile-all.test.mjs` | `PASS LOCALLY` | 12 tests, 12 passed.                                                                                                                                                                                                                                                               |
| Evidence tooling tests              | `node --test infra/scripts/evidence.test.mjs`      | `PASS LOCALLY` | 14 tests, 14 passed.                                                                                                                                                                                                                                                               |
| Documentation and command tests     | `node --test infra/scripts/docs.test.mjs`          | `PASS LOCALLY` | 7 tests, 7 passed, once all six release documents existed.                                                                                                                                                                                                                         |
| Shared contract tests               | `pnpm --filter @aegis/contracts test`              | `PASS LOCALLY` | 64 tests, 64 passed.                                                                                                                                                                                                                                                               |
| SABCL protocol package tests        | `pnpm sabcl:test`                                  | `PASS LOCALLY` | 117 tests, 117 passed.                                                                                                                                                                                                                                                             |
| SABCL metadata leakage tests        | `pnpm sabcl:test:leakage`                          | `PASS LOCALLY` | 15 tests, 15 passed. These are a re-run of two files inside the 117 above, not additional tests.                                                                                                                                                                                   |
| SABCL router unit tests             | `pnpm sabcl:test:router`                           | `PASS LOCALLY` | 1 suite, 21 tests passed.                                                                                                                                                                                                                                                          |
| API Gateway unit tests              | `pnpm --filter @aegis/api-gateway test`            | `PASS LOCALLY` | 13 suites, 123 tests passed.                                                                                                                                                                                                                                                       |
| Identity service unit tests         | `pnpm --filter @aegis/identity-service test`       | `PASS LOCALLY` | 9 suites, 29 tests passed.                                                                                                                                                                                                                                                         |
| Ledger service unit tests           | `pnpm ledger:test`                                 | `PASS LOCALLY` | 12 suites, 112 tests passed.                                                                                                                                                                                                                                                       |
| Payments service unit tests         | `pnpm payments:test`                               | `PASS LOCALLY` | 8 suites, 55 tests passed, covering QR, USSD and agent cash.                                                                                                                                                                                                                       |
| Risk service unit tests             | `pnpm risk:test`                                   | `PASS LOCALLY` | 2 suites, 26 tests passed.                                                                                                                                                                                                                                                         |
| Resilience service unit tests       | `pnpm resilience:test`                             | `PASS LOCALLY` | 2 jest suites, 16 tests passed, plus 27 tests in the recovery tooling suite under `services/resilience/scripts`.                                                                                                                                                                   |
| Web component tests                 | `pnpm web:test`                                    | `PASS LOCALLY` | 19 test files, 116 tests passed.                                                                                                                                                                                                                                                   |

Across the workspace that is 706 passing tests, plus 81 tooling tests, all of
which passed. Nothing in that total needed a database, a cache or a browser;
those suites are in section 5.

### Note on the formatting failure

`pnpm format:check` reports three files, and none is a defect in source code.

The first is `.github/workflows/ci.yml`, where the difference is entirely line
endings. The working copy on this Windows VM contains CRLF; Prettier is
configured with `"endOfLine": "lf"` in `.prettierrc.json`. When the file's line
endings are normalized to LF, the content is byte-for-byte identical to
Prettier's output — 22,490 bytes either way, against 22,972 bytes with the
carriage returns. `.gitattributes` declares `* text=auto eol=lf`, so Git stores
and checks out the LF form regardless of what the Windows working copy holds,
and `git diff` says so directly: "CRLF will be replaced by LF the next time Git
touches it".

The other two are `audit-findings.json` and `audit-live.json` at the repository
root, untracked working files produced while the final audit was being written.
Neither is part of the repository, and both should be removed or ignored before
the submission commit; they are named here rather than quietly excluded because
the command did report them.

This row is recorded as `FAIL` rather than explained away, because the command
did fail. Two facts bound how much it means: the workflow has no formatting
step, so it cannot change any CI result, and `pnpm format` normalizes the
working copy. Once the untracked files are gone and the tree is normalized,
re-run `pnpm format:check` and record `PASS LOCALLY` in place of this row.

### Note on the documentation gate

An earlier run of `node --test "infra/scripts/*.test.mjs"` returned 79 of 81,
with two assertions in `infra/scripts/docs.test.mjs` failing: `every release
document exists` and `every relative markdown link points at a file that
exists`. The reported links were references from
`docs/release/SUBMISSION_CHECKLIST.md` to release documents that had not been
written at that moment. That was the documentation gate working as intended
during this release, not a defect: the suite requires all six release documents —
[FINAL_DEMO_GUIDE.md](./FINAL_DEMO_GUIDE.md),
[SUBMISSION_CHECKLIST.md](./SUBMISSION_CHECKLIST.md), this report,
[RELEASE_NOTES.md](./RELEASE_NOTES.md),
[final-capability-audit.md](./final-capability-audit.md) and
[final-security-review.md](./final-security-review.md) — to exist, and it fails
until they all do.

With all six present the suite passes: 81 of 81, and 7 of 7 in the documentation
file alone. CI runs the same file as the named step **Validate documented
commands and release documents**, so a missing release document, a documented
command that does not exist, or a broken relative link fails the `test` job.
That is the check to trust, not a local snapshot taken mid-edit.

### A local result that is about this machine, not the repository

`pnpm env:check` fails on the development VM. It reports that the machine's
`.env` is missing the Risk and Resilience variables and that one key is not 32
bytes, naming each variable and printing no values — the file on this machine was
generated before those services existed, and holds 119 variables against the 244
lines of `.env.example`. That is a property of one untracked local file, not of
the repository, and the remedy is documented: `pnpm env:init:local -- --force`
regenerates it. It is recorded here because the run happened, and because the
run also demonstrates the behaviour the tool promises — every problem is named by
variable, and the output ends with "configuration is incomplete; no values were
displayed".

## 4. What the local pass does not cover

A green local run is a real result with a narrow scope. It does not show:

- that any migration applies, because no database was reachable;
- that the double-entry constraints, deferred triggers or balance projections
  behave under real PostgreSQL, because those are integration suites;
- that replay protection, session revocation, velocity state or USSD session
  expiry behave against real Redis;
- that any browser journey works, in any of the three languages, at any
  viewport;
- that a backup set can be produced, verified, refused when tampered with, or
  restored into disposable databases;
- that a recovery drill completes or that its measurements are reproducible;
- that any of the four reconciliations agrees with the data.

Every one of those is in the next section, and every one of them is CI's to
prove.

## 5. CI evidence

Read from the run log of 30725063393, not inferred from the job status. Selected
verbatim evidence:

```text
Selected backup set: backup:2026-08-02:40b6812a
A backup set must be named explicitly.
The named backup set was not found.
A backup set identifier must be an opaque token, not a path.
{"status":"PASS","controlVerified":true,"cases":[
  {"case":"wrong-key","outcome":"REFUSED"},{"case":"tampered-ciphertext","outcome":"REFUSED"},
  {"case":"missing-file","outcome":"REFUSED"},{"case":"incomplete-set","outcome":"REFUSED"},
  {"case":"duplicate-service","outcome":"REFUSED"},{"case":"path-traversal-filename","outcome":"REFUSED"},
  {"case":"unsupported-manifest-version","outcome":"REFUSED"},
  {"case":"unsupported-algorithm","outcome":"REFUSED"},{"case":"symlink-escape","outcome":"REFUSED"}]}
{"event":"drill.passed","drillId":"drill:2026-08-02:63c10c12",
 "backupSetId":"backup:2026-08-02:cdf1437f",
 "measuredRecoveryPointAgeSeconds":2,"measuredRecoveryDurationMs":1169}
[reconcile] results:
  ledger      PASS     no summary
  payments    PASS     issueCount=1 checkedTransfers=14 checkedIntents=18
  risk        PASS     expiredControls=0
  resilience  PASS     issueCount=4 checkedDrills=12 checkedBackupSets=4
```

The drill created, verified, restored and recorded the same set —
`backup:2026-08-02:cdf1437f` — throughout, which is the property the explicit
selection work exists to guarantee. Restored table counts were identity 7,
ledger 8, payments 10, risk 11, resilience 5.

`ledger PASS no summary` is accurate rather than a defect: the Ledger
reconciliation emits its result inside a framework log line rather than as a bare
JSON line, so the allow-listed summariser has nothing to copy and says so instead
of inventing a figure. Its exit code is what determines the verdict.

Docker-dependent acceptance is performed by GitHub Actions and is authoritative
there. The workflow defines exactly four jobs — `lint`, `typecheck`, `test` and
`build` — and the `test` job is where this evidence lives. It starts real
PostgreSQL 17 and Redis, installs the matching PostgreSQL 17 client tools so the
recovery tooling is never run against a mismatched `pg_dump`, applies all five
committed migration sets, and then runs the suites below. The table groups them
by check so that a reader can find one thing at a time; it is not the job's step
order, and where the two differ — the Ledger, Payments and Risk reconciliations
run before the backup and drill steps, not after them — the workflow file is the
authority.

> **CI run identifier: 30725063393**
> **Commit under test: `5ac91eb`**
> **Conclusion: success — `lint`, `typecheck`, `test` and `build` all green**
>
> The preceding run, 30724667322 on commit `17fbbe5`, failed at **Create an
> encrypted backup set and verify it by explicit identifier**. `pnpm` forwards
> the `--` end-of-options separator through a nested invocation, so
> `backup-verify.mjs` received `['--', '--set', '<id>']` and refused it. That is
> the invocation form documented throughout this repository, so the documented
> command was broken everywhere it appeared. Fixed in `5ac91eb`; a regression
> test now covers the separator, and the rule that a bare command must fail is
> unchanged and still asserted in CI.
>
> The maintainer fills these three lines in from the run for the submitted
> commit, and fills in the status column below from the same run. No run
> identifier, timestamp or conclusion is written here in advance.

| Check                            | Exact step name in the `test` job                                                                                                                                                                                                                                                                      | Command                                                                                                                                                           | Status       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Infrastructure startup           | **Validate infrastructure configuration**, **Start PostgreSQL and Redis**, **Check infrastructure health**, **Install PostgreSQL 17 client tools**                                                                                                                                                     | `pnpm infra:validate`, `pnpm infra:up`, `pnpm infra:check`, then `apt-get install postgresql-client-17`                                                           | `PASS IN CI` |
| The five migrations              | **Apply committed Identity migrations**, **Apply committed Ledger migrations**, **Apply committed Payments migrations**, **Apply committed Risk migrations**, **Apply committed Resilience migrations**                                                                                                | `pnpm db:deploy:identity`, `pnpm db:deploy:ledger`, `pnpm db:deploy:payments`, `pnpm db:deploy:risk`, `pnpm db:deploy:resilience`                                 | `PASS IN CI` |
| Integration tests                | **Test Risk PostgreSQL, Redis, ingestion and lifecycle integration**, **Test Resilience PostgreSQL append-only drill evidence**, **Test Ledger PostgreSQL transfer integration and concurrency**, **Test Payments PostgreSQL transfer processing**, **Test SABCL router with real Redis replay state** | `pnpm risk:test:integration`, `pnpm resilience:test:integration`, `pnpm ledger:test:integration`, `pnpm payments:test:integration`, `pnpm sabcl:test:integration` | `PASS IN CI` |
| End-to-end tests                 | **Test authentication end to end**, **Test authenticated account and transaction routes end to end**, **Test real Gateway Identity Payments Ledger transfers end to end**, **Test strict-mode encrypted end-to-end journey through the router**                                                        | `pnpm auth:test:e2e`, `pnpm transactions:test:e2e`, `pnpm payments:test:e2e`, `pnpm sabcl:test:e2e`                                                               | `PASS IN CI` |
| Playwright functional            | **Install Playwright Chromium**, then **Test real transfer Playwright journey and browser flows**                                                                                                                                                                                                      | `pnpm web:test:e2e`                                                                                                                                               | `PASS IN CI` |
| Playwright accessibility         | **Test transfer accessibility including EN SI TA and mobile states**                                                                                                                                                                                                                                   | `pnpm web:test:a11y`                                                                                                                                              | `PASS IN CI` |
| Explicit backup-set verification | **Create an encrypted backup set and verify it by explicit identifier**, then **Refuse a bare, ambiguous or unknown backup selection**                                                                                                                                                                 | `pnpm dr:backup`, then `pnpm dr:backup:verify -- --set "$set_id"`                                                                                                 | `PASS IN CI` |
| Negative backup validation       | **Refuse tampered, wrong-key, incomplete and unsafe backup sets**                                                                                                                                                                                                                                      | `pnpm dr:backup:verify:negative -- --set "$AEGIS_BACKUP_SET_ID"`                                                                                                  | `PASS IN CI` |
| Isolated restore verification    | **Verify an isolated restore into disposable databases**                                                                                                                                                                                                                                               | `pnpm dr:restore:verify -- --set "$AEGIS_BACKUP_SET_ID"`                                                                                                          | `PASS IN CI` |
| Disaster-recovery drill          | **Run the deterministic disaster-recovery drill**                                                                                                                                                                                                                                                      | `pnpm dr:drill`, with Risk and Resilience started and health-checked first                                                                                        | `PASS IN CI` |
| Ledger reconciliation            | **Reconcile Ledger and Payments**; also inside **Run the deterministic disaster-recovery drill** and **Aggregate reconciliation across Ledger, Payments, Risk and Resilience**                                                                                                                         | `pnpm ledger:reconcile`                                                                                                                                           | `PASS IN CI` |
| Payments reconciliation          | **Reconcile Ledger and Payments**; also inside the drill and the aggregate step                                                                                                                                                                                                                        | `pnpm payments:reconcile`                                                                                                                                         | `PASS IN CI` |
| Risk reconciliation              | **Reconcile Risk links and controls**; also inside the drill and the aggregate step                                                                                                                                                                                                                    | `pnpm risk:reconcile`, against a Risk service started for the step and shut down after it                                                                         | `PASS IN CI` |
| Resilience reconciliation        | No standalone step. It runs inside **Run the deterministic disaster-recovery drill** and inside **Aggregate reconciliation across Ledger, Payments, Risk and Resilience**                                                                                                                              | `pnpm resilience:reconcile`, invoked by `pnpm dr:drill` and by `pnpm reconcile:all`                                                                               | `PASS IN CI` |
| Aggregate reconciliation         | **Aggregate reconciliation across Ledger, Payments, Risk and Resilience**                                                                                                                                                                                                                              | `pnpm reconcile:all`                                                                                                                                              | `PASS IN CI` |
| Cleanup                          | **Remove backup working directory and assert no plaintext remains**, then **Stop application services and infrastructure**                                                                                                                                                                             | A `find` assertion over `DR_BACKUP_DIR` and `/tmp/aegis-dr-*`, then `pnpm infra:down`                                                                             | `PASS IN CI` |

Four details in that table are worth reading twice, because they are the
difference between a drill and a demonstration of a drill:

- The backup step does not guess which set to examine. It captures the backup's
  own output, extracts the `backupSetId` from the `PASS` record, prints
  `Selected backup set: <id>`, and carries that identifier into every later
  step through `GITHUB_ENV`. A bare `pnpm dr:backup:verify` is refused by the
  tooling, and the next step proves the refusal by failing the job if the bare
  command succeeds.
- The refusal step also asserts that an unknown identifier and a path-shaped
  identifier are both rejected, while `-- --latest` still works when an operator
  asks for it. `--latest` selects on the manifest's `createdAt`, and two sets
  sharing the newest timestamp is an error rather than a coin toss.
- The restore verification creates freshly named disposable databases, checks
  them against the live service database names, and drops what it created.
- The cleanup step runs with `if: always()`, so it executes after a failure as
  well as a pass, and it fails the job if a decrypted dump survived or a working
  directory was left behind. CI never uploads dumps, decrypted files, `.env`,
  tokens or keys; the only artifact is the Playwright report, and only on
  failure.

## 6. What a green job name proves, and what it does not

A judge reading a workflow summary sees four names with ticks. Here is exactly
what that is worth.

A green `test` tick **does** prove that, on the commit the run was triggered for,
every step in the job exited zero: the containers started, all five migration
sets applied to a real PostgreSQL 17, and each named suite ran to completion
without a failing assertion. Because several steps are written as inverted
assertions — the refusal step fails the job if a bare verify succeeds, the
cleanup step fails the job if a plaintext dump survived — a green tick there also
proves that certain things did **not** happen.

A green tick **does not** prove any of the following, and none of it should be
read into one:

- **That it is the submitted commit.** The concurrency group cancels superseded
  runs, and a branch moves. A tick next to an older commit says nothing about the
  one being handed over. Check the commit SHA on the run.
- **That the assertions inside a suite are meaningful.** A test that asserts
  nothing passes. The tick is evidence that the code ran, not that the checks are
  good ones; the suites themselves are the argument.
- **That the whole job is green.** The final step, **Stop application services
  and infrastructure**, carries `continue-on-error: true`, so a failure to tear
  down infrastructure cannot redden the job. Read that step rather than assuming
  its state from the job's colour.
- **That local behaviour matches.** CI runs Ubuntu and the `.nvmrc` Node version;
  the development VM runs Windows and a different Node major. A green CI run is
  not a statement about a demonstration laptop.
- **That the system is production-ready.** CI proves the prototype's own
  behaviours against local disposable infrastructure and nothing beyond that.
  Section 7 is the boundary.

**So read the log, not the tick.** Open the workflow run for the submitted
commit, open the `test` job, and expand the steps by name. Useful things to look
for, all of which the job prints:

- `Selected backup set: <identifier>` in the backup step, and the same
  identifier flowing into the negative, restore and drill steps.
- The drill's recorded measurements — a measured prototype recovery-point age
  and a measured prototype recovery duration — rather than a bare "drill passed".
- The four reconciliation outputs, and the aggregate run agreeing with them.
- The cleanup step's assertions at the end, which run on every outcome.
- The step **Validate documented commands and release documents**, which is the
  reason a documented command cannot silently stop existing.

## 7. Honest limitations

This is a hackathon prototype, not a production banking system. It does not
provide production multi-region disaster recovery, continuous replication, zero
data loss, compliance certification, a guaranteed production recovery-point or
recovery-time objective, protection against the loss of a cloud region or
provider, a trained fraud model, production workforce identity, external payment
rails, or production messaging.

The recovery figures produced by the drill are a **measured prototype
recovery-point age** and a **measured prototype recovery duration**, obtained
from a drill run against local disposable infrastructure. They are measurements
of this prototype under those conditions and are not objectives, guarantees or
predictions about any other environment.

Use synthetic data only. Never real money, never real credentials. Every
credential in the workflow is an obvious throwaway, and no real secret is
committed or printed anywhere in this repository.

Backups cover the five PostgreSQL databases and deliberately exclude Redis: its
cache, replay and velocity state is recreatable, and backing it up would widen
the blast radius of a stolen backup set without improving recovery.

## 8. Related documents

- [.github/workflows/ci.yml](../../.github/workflows/ci.yml) — the authoritative
  workflow, with the step names quoted in section 5.
- [SUBMISSION_CHECKLIST.md](./SUBMISSION_CHECKLIST.md) — the operational
  checklist that this report is expected to agree with, label for label.
- [FINAL_DEMO_GUIDE.md](./FINAL_DEMO_GUIDE.md) — the walkthrough, including the
  full port list.
- [final-capability-audit.md](./final-capability-audit.md) — capability by
  capability, with the evidence for each.
- [final-security-review.md](./final-security-review.md) — the security review.
- [RELEASE_NOTES.md](./RELEASE_NOTES.md) — what shipped.
- [Disaster recovery runbook](../operations/disaster-recovery-runbook.md) and
  [backup and restore runbook](../operations/backup-restore-runbook.md) — the
  operator procedures behind the DR rows above.
- [Architecture overview](../architecture/README.md) — service boundaries, ports
  and data ownership.

## 9. Reproducing this report

Every local row can be re-run from the repository root, in this order:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
node --test "infra/scripts/*.test.mjs"
pnpm test
```

`pnpm test` runs the tooling suites and then the workspace suites through Turbo.
Turbo caches by content hash, so a second run may replay logs instead of
executing; the lint, typecheck and build runs recorded above reported 8 of 10
tasks served from cache, and the workspace test run was executed with `--force`
so that every suite ran for real. Add `--force` to any command whose output you
want to see produced rather than replayed.

The Docker-dependent rows cannot be reproduced without a working engine. On a
machine that has one, `pnpm demo:start`, `pnpm demo:verify`, `pnpm reconcile:all`
and `pnpm dr:drill` are the four commands that exercise most of section 5 —
but a result from such a machine is that machine's result, and CI remains the
authoritative record for this submission.
