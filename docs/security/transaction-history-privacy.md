# Customer transaction-history privacy boundary

The customer API exposes a stable display reference, account UUID, direction,
category, posted status, monetary values, balance after, and effective/posted
timestamps. It never exposes journal references, ledger-account IDs, account
codes, correlation IDs, idempotency records, descriptions, metadata, actor
fields, or internal service credentials.

The display reference is deterministic presentation data only. It is not an
authorization capability. Ownership is enforced by the Ledger using the
authenticated customer identity supplied by the Gateway.

History responses use private, no-store caching. Cursors disclose no raw ledger
identifier and are bound to the active filters. Residual risks include traffic
analysis at infrastructure layers and growth of per-account history reads; both
remain operational concerns outside the browser contract.
