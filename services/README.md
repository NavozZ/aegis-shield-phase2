# Services

This workspace contains independently runnable AEGIS Shield services.

Implemented:

- [`identity`](identity/README.md) — customer identity, Tier-0 onboarding, PIN plus OTP fallback, passkey backend, sessions, and authentication events
- [`ledger`](ledger/README.md) — customer accounts, immutable double-entry journals, balance projections, idempotency, and reconciliation
- [`payments`](payments/README.md) — transfer intents, limits, idempotent orchestration, recovery, append-only events, and reconciliation

Planned service areas:

- `threat-detection` — risk signals, scoring, and bounded response
- `sabcl-proxy` — SABCL metadata-protected communication
- `notifications` — channel-neutral notification delivery
- `recovery` — restore, reconciliation, and recovery coordination

Identity owns `aegis_identity` and its Redis namespace, Ledger owns `aegis_ledger`, and Payments owns `aegis_payments`. Services exchange validated HTTP contracts and never share tables.
