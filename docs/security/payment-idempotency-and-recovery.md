# Payment idempotency and recovery

## Confirmation identity

The browser generates one idempotency key for a confirmation and retains it in React memory across retries. Gateway validates and forwards it; Payments stores only its SHA-256 hash under a unique `(sender_customer_id, idempotency_key_hash)` constraint. A canonical request hash binds the key to sender, intent, source, recipient, currency, and exact minor-unit amount. Same key/same request replays the original row; same key/different request returns a conflict.

Payments consumes the authorized intent and creates `PROCESSING` plus append-only events in one PostgreSQL transaction. Ledger receives `transfer:<transfer-id>` as its own idempotency key, so a retry after a lost response returns the original journal rather than posting again.

## Recovery algorithm

1. Select stale, due `PROCESSING` rows with `FOR UPDATE SKIP LOCKED`.
2. Increment the attempt count, append `RECOVERY_RETRY`, and set a short lease.
3. Repeat the identical Ledger command outside the claim transaction.
4. Move conclusively posted work to `COMPLETED`; preserve terminal business rejection as `FAILED`.
5. Leave another ambiguous outcome `PROCESSING`; after the configured bound, append evidence and move it to `REQUIRES_REVIEW`.

Multiple workers can run concurrently because row claiming skips locked work. Operators must never edit transfer events, journal entries, postings, hashes, or balances. After recovery, run:

```powershell
pnpm ledger:reconcile
pnpm payments:reconcile
```

A failed reconciliation is a deployment/incident stop condition, not a warning to suppress.
