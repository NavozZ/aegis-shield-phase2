# Security event contract

The contract is `securityEventV1Schema` in `@aegis/contracts`. Required fields are schema version, UUID event ID, trusted source, stable source event ID, event type, severity, occurred time, received time (server assigned), correlation ID and allowlisted attributes. Optional identifiers are opaque customer, account, session, device and recipient values.

`(source, sourceEventId)` is unique. Duplicate delivery returns the original event and increments source-health duplicate count; an older `occurredAt` received later remains an immutable fact. Each source has a separate credential and a 1,000-event/minute bounded rate. JSON bodies are limited to 32 KiB.

Allowed attributes describe operation, outcome, integer minor-unit amount, currency, safe failure/integrity code, bounded route/method/status, step-up state, recipient novelty and coarse provider-derived region codes. Raw credentials, OTPs, PINs, cookies, tokens, phone numbers, unmasked account references and arbitrary JSON keys are rejected by policy or schema.
