# Risk privacy and retention

Risk uses opaque UUIDs or hashed device/session-derived identifiers. Redis key names hash scope identifiers and always have TTLs. PostgreSQL events permit only safe, bounded contextual attributes. Protected personal characteristics are neither collected nor used by rules.

Unlinked security events are retained for 90 days by default (`RISK_EVENT_RETENTION_DAYS`, 1–365). The retention job deletes only events older than the received-time cutoff with no assessment link. Assessments and event/control/incident/operator histories remain immutable audit records under the applicable governance schedule. Source-health counts contain no customer data.

Operators see opaque/masked identifiers and safe explanations. Logs include correlation IDs, error class and counts—not credentials, internal tokens, raw sessions, PINs, OTPs or full account references.
