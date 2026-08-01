# Automated control policy

Every control has an ID, idempotency hash, type, scope type, opaque scope ID, reason code, assessment/incident link where applicable, actor, status, creation time, expiry and append-only lifecycle events. Automated controls are temporary: step-up 5 minutes, transfer hold 10 minutes and quarantine 15 minutes in rule set v1.

Moderate risk uses `REQUIRE_STEP_UP`. High risk uses `TRANSFER_HOLD`; critical risk uses scoped `QUARANTINE`. Operators may apply temporary controls only with an expiry and reason, and may release them only with an audited explanation. `SESSION_REVOKE` invokes Identity. No Risk action changes a balance or journal.

Expired controls are changed to `EXPIRED` by an idempotent job and receive a lifecycle event. Release does not delete history. A duplicate idempotency key returns the same control; a session-revocation retry calls Identity again safely.
