# Threat detection threat model

| Threat                        | Control                                                                              | Residual risk                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Source impersonation          | Per-source token matched to claimed source, loopback/private deployment, rate limits | Local shared-host compromise requires workload identity/mTLS in production.        |
| Event replay                  | Stable unique source event ID; idempotent response                                   | A source can emit distinct malicious IDs if fully compromised.                     |
| Forged score/decision         | Strict fact-only contract; Payments evaluates authoritative intent                   | Compromised trusted services can lie about facts.                                  |
| Huge/secret payload           | 32 KiB body limit, strict allowlist, safe logging                                    | Semantic secrets placed in an allowed short string require source review/scanning. |
| Control bypass                | Gateway check plus independent Payments enforcement                                  | Risk outage intentionally denies sensitive transfers.                              |
| Concurrent confirmation race  | Existing Payments/Ledger idempotency and locks plus pre-posting Risk enforcement     | Control activation racing after posting cannot reverse a completed journal.        |
| Operator CSRF/customer access | Separate HttpOnly operator session, role validation, CSRF, rate limit and audit      | Development bootstrap token must remain local and rotated.                         |
| Permanent accidental block    | Required expiry and expiry job/history                                               | Manually authorized permanent controls are intentionally not implemented.          |

Rule detection is not a trained fraud model and must be combined with human review, source hardening, reconciliation and monitored false-positive rates.
