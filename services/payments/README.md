# Payments service

Payments is the private customer-transfer orchestrator. It owns `aegis_payments`; no other service reads or writes its tables. The browser cannot call it directly.

It creates short-lived transfer intents, reserves the sender's daily outgoing limit, enforces customer-scoped idempotency, records an append-only lifecycle, calls Ledger with a deterministic command key, recovers uncertain outcomes, and reconciles its records with Ledger. Money uses decimal strings at browser boundaries and `bigint` minor units internally.

## State model

`PROCESSING` is written before the Ledger call. A conclusive Ledger acceptance becomes `COMPLETED`; a safe terminal business rejection becomes `FAILED`; an unavailable or ambiguous response remains `PROCESSING`. Recovery claims stale work with `FOR UPDATE SKIP LOCKED`, repeats the same Ledger command, and moves exhausted work to `REQUIRES_REVIEW`. It never invents a successful payment.

Intent tokens and idempotency keys are stored only as SHA-256 hashes. Transfer events are append-only by PostgreSQL trigger. Public mappings exclude customer IDs, account-internal IDs, token hashes, request hashes, correlation IDs, Ledger IDs, and the recipient's full reference.

## Commands

```powershell
pnpm payments:test
pnpm payments:test:integration
pnpm payments:test:e2e
pnpm payments:recover
pnpm payments:reconcile
```

Integration, e2e, recovery, and reconciliation require healthy PostgreSQL and the committed migrations. Recovery and reconciliation are safe to repeat. See [payment idempotency and recovery](../../docs/security/payment-idempotency-and-recovery.md) and the [transfer threat model](../../docs/security/transfer-threat-model.md).
