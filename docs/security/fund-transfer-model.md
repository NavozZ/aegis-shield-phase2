# Customer fund transfer model

Internal LKR customer-to-customer transfers are in scope here. It is a
synthetic prototype only: no external bank rail, card processor, merchant
payment, or real customer funds are connected.

## Boundaries

The browser talks only to the API Gateway. The Gateway checks the protected
session, double-submit CSRF token, and a fresh transfer-PIN step-up with the
Identity service. The PIN is never sent to Payments or Ledger.

Payments owns transfer intents, idempotency, daily outgoing limits, lifecycle
events, recovery and reconciliation records in `aegis_payments`. An intent
token is 256-bit random material returned once to the browser; only its SHA-256
hash is persisted. Payments keeps a transfer in `PROCESSING` when the Ledger
outcome is uncertain, preventing an unsafe retry.

Ledger is the sole balance authority. It resolves the recipient's public
receiving reference, checks customer ownership and account state, then posts a
balanced `CUSTOMER_TRANSFER` journal with one debit and one credit. Browser
transaction history maps that journal to `TRANSFER` with `OUTGOING` for the
sender and `INCOMING` for the recipient.

## Operations

Run `pnpm payments:recover` to process stale `PROCESSING` records and
`pnpm payments:reconcile` to write a payments reconciliation run. These tools
need the standard Payments and Ledger environment variables and should run
after migrations have been applied. Recovery is intentionally conservative:
records that exhaust configured retries move to `REQUIRES_REVIEW` rather than
being posted again.

`transfer_events` are append-only at the database layer: database triggers
reject updates and deletes. Operators must not edit balances, postings, intent
hashes, transfer events, or idempotency records directly.

## Safe data exposure

The account owner may see their receiving reference. Other browser responses
contain only masked account references, transfer display references, amounts,
status, timestamps, and resulting balance where applicable. They do not expose
ledger account identifiers, customer identifiers, token hashes, internal
idempotency hashes, PINs, or journal metadata.
