# Contributing to AEGIS Shield

Thank you for helping build AEGIS Shield. Contributions must preserve the platform's service boundaries, financial correctness, security model, and reproducible demonstration goals.

## GitHub Flow

`main` is the only long-lived branch and must remain reviewable and releasable. Direct pushes to `main` are not permitted. Start every change from an up-to-date `main`, work on a short-lived branch, and merge through a reviewed pull request.

One implementation prompt equals one branch and one pull request. Do not combine unrelated prompts or opportunistic refactors.

## Branch naming

Use `<type>/<prompt>-<short-description>` in lowercase kebab case. Valid types include `feature`, `fix`, `chore`, `docs`, `test`, `security`, and `refactor`.

Examples:

```text
chore/p00-repository-foundation
feature/p03-identity-service
security/p12-workload-authentication
```

## Commit messages

Use Conventional Commits in the form `<type>(<scope>): <imperative summary>`.

Examples:

```text
feat(identity): add customer token rotation
fix(payments): preserve idempotency result
docs(architecture): describe ledger ownership
```

Keep commits focused. Never amend or rewrite another contributor's published work without coordination.

## Pull-request workflow

1. Update local `main` using a fast-forward-only pull.
2. Create the prompt-specific branch from the latest `origin/main`.
3. Implement only the agreed scope and add relevant tests and documentation.
4. Run all required local checks.
5. Push the branch and open a pull request using the repository template.
6. Address review findings with new commits.
7. Obtain required approvals and passing checks.
8. Squash-merge the pull request; do not create additional long-lived branches.

The pull request must explain architecture and security impacts, testing evidence, and rollback considerations. Draft pull requests are encouraged for early design feedback.

## Required local checks

Run every formatter, linter, type check, unit test, integration test, security check, and build relevant to the changed area. Exact commands will be added as toolchains are introduced. Until then, validate documentation links, YAML/JSON syntax, line endings, and the absence of secrets.

Do not mark a check complete when it was not run. Record known failures and their cause in the pull request.

## No secrets policy

Never commit passwords, tokens, private keys, real certificates, connection strings containing real credentials, personal data, banking credentials, or production configuration. Use clearly fake values in `.env.example`; keep actual local values in ignored `.env` files. Revoke and report any accidentally exposed secret immediately—deleting it in a later commit is insufficient.

## Code review expectations

Reviewers should verify correctness, clarity, tests, error handling, service and data ownership, authorization boundaries, auditability, backward compatibility, and operational impact. Security-sensitive and financial-integrity changes require especially careful review. Authors must respond to actionable feedback, and reviewers must not approve changes they have not understood.
