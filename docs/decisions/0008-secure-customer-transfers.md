# ADR 0008: Secure customer transfers

- Status: accepted
- Date: 2026-08-01

## Context

Customer transfers combine authorization, balance correctness, retries, privacy, and partial failure. A browser retry must not create another debit, and a lost Ledger response must not be interpreted as either success or failure without evidence.

## Decision

Use a dedicated Payments service as a saga-like orchestrator and keep Ledger as the sole balance authority. Gateway derives the customer from an Identity session, checks double-submit CSRF, and sends the PIN only to Identity for step-up verification. Payments creates a short-lived opaque intent and later persists `PROCESSING` before asking Ledger to post one immutable `CUSTOMER_TRANSFER` journal with exactly two postings.

Payments and Ledger each enforce idempotency at their own boundary. Account locks are acquired in sorted UUID order. Ambiguous calls remain `PROCESSING`; bounded recovery repeats the same Ledger command and eventually chooses `COMPLETED` or `REQUIRES_REVIEW`. Public contracts contain only masked references and customer-safe status data.

## Consequences

- No distributed database transaction is required.
- A customer can safely retry a lost response with the same key.
- Temporary uncertainty is visible and recoverable instead of becoming a double debit.
- Operators must run both reconciliations and investigate `REQUIRES_REVIEW` without editing append-only evidence.
- This is an internal synthetic LKR transfer only; no external rail or live financial trading is connected.
