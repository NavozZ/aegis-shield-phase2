# Threat detection and control demo

1. Configure synthetic local secrets, including a random development operator bootstrap token.
2. Start PostgreSQL/Redis, deploy all migrations and build/start Identity, Ledger, Risk, Payments, Gateway and Web.
3. Sign in as a customer and complete a normal low-risk transfer.
4. Ingest repeated synthetic failed-authentication events through the authenticated event API. Confirm a deterministic step-up decision.
5. Continue with a synthetic integrity/replay signal. Confirm a temporary quarantine/hold and incident; retrying the transfer is generically denied.
6. Sign in at `/security-ops/sign-in`, inspect rules/reasons, assign and resolve the incident, then release the temporary control with a reason.
7. Confirm normal operation resumes and histories remain visible.
8. Run `pnpm ledger:reconcile`, `pnpm payments:reconcile` and `pnpm risk:reconcile`, then stop all processes and `pnpm infra:down`.

Use synthetic data only. The browser test `security-ops.spec.ts` automates escalation, triage, release, recovery, responsive layout and axe checks.
