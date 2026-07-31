# Services

This workspace contains independently runnable AEGIS Shield services.

Implemented:

- [`identity`](identity/README.md) — customer identity, Tier-0 onboarding, PIN plus OTP fallback, passkey backend, sessions, and authentication events
- [`ledger`](ledger/README.md) — customer accounts, immutable double-entry journals, balance projections, idempotency, and reconciliation

Planned service areas:

- `payments` — idempotent transfer and payment workflows
- `threat-detection` — risk signals, scoring, and bounded response
- `sabcl-proxy` — SABCL metadata-protected communication
- `notifications` — channel-neutral notification delivery
- `recovery` — restore, reconciliation, and recovery coordination

Identity owns only the `aegis_identity` database and its Redis namespace; the Ledger owns only the `aegis_ledger` database. Each future stateful service must likewise own its database boundary and expose explicit contracts rather than sharing tables.
