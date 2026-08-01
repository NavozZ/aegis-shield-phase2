# Threat detection and automated controls architecture

Gateway, Identity, Payments, Ledger and infrastructure adapters publish strict events to Risk. Risk persists the original fact, updates bounded Redis counters, evaluates versioned deterministic rules, stores an explanation and creates an expiring control or incident when policy requires it.

Enforcement is deliberately repeated at meaningful boundaries. Gateway checks active controls before transfer step-up and assesses the authenticated subject after step-up. Payments independently assesses its authoritative intent amount, account and recipient immediately before creating a posting operation. Identity alone revokes sessions through an authenticated internal command. Ledger remains the only journal and balance authority.

```text
browser -> Gateway -> Identity (session / fresh PIN step-up)
                 |-> Risk (control check + assessment)
                 `-> Payments -> Risk (authoritative intent assessment)
                              `-> Ledger (posting only after allow)

Identity / Gateway / Payments / Ledger -> Risk event ingestion
security operator -> Gateway operator boundary -> Risk incidents/controls
Risk SESSION_REVOKE -> Identity trusted revocation command
```

No service shares a database. A subject-specific control cannot disable unrelated subjects. Event telemetry failures are fail-open for normal authentication and non-posting reads; transfer enforcement and operator mutations are fail-closed with bounded two-second timeouts.
