# Incident response runbook

1. Confirm source health and review the assessment's score, triggered rules and safe evidence references.
2. Assign the incident and move it to `INVESTIGATING`.
3. Validate that controls are subject-scoped, justified and expiring. Apply a temporary control only when the evidence supports it.
4. Contain verified threats; never edit Identity, Payments or Ledger data directly.
5. Record operator notes without credentials, raw sessions or full account references.
6. Resolve as `RESOLVED` or `FALSE_POSITIVE` with a reason. Release controls separately with an audited reason.
7. Reopen when new evidence arrives. Run Risk, Payments and Ledger reconciliation before declaring recovery.

For a Risk outage, transfers remain safely unavailable while normal authentication telemetry may queue only in the source's local audit. Restore Risk, verify source freshness, replay only stable event IDs, run recovery/reconciliation, then restore sensitive operations.
