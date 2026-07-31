# Future services

This workspace boundary is reserved for independently deployable AEGIS Shield services. Prompt 01 does not scaffold or implement them.

Planned service areas:

- `identity` — customer identity and workload authentication
- `accounts-ledger` — account ownership, balances, and double-entry ledger
- `payments` — idempotent transfer and payment workflows
- `threat-detection` — risk signals, scoring, and bounded response
- `sabcl-proxy` — SABCL metadata-protected communication
- `notifications` — channel-neutral notification delivery
- `recovery` — restore, reconciliation, and recovery coordination

Each stateful service will own its database boundary and expose explicit contracts when introduced by a later prompt.
