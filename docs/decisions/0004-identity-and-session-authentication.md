# ADR 0004: Identity and session authentication

- Status: Accepted
- Date: 2026-07-31

## Context

Customer authentication handles higher-risk credentials, enumeration controls, session lifecycle, and passkey state. Keeping this logic in the Gateway would combine public traffic routing with authoritative identity data and make independent hardening and failure isolation difficult.

## Decision

Identity is an independently runnable, loopback-bound service with its own PostgreSQL schema and Redis namespace. The Gateway is the only public caller and authenticates with a development service token; workload identity or mTLS will replace that shared bootstrap control in production.

Sessions are opaque random values stored as hashes in Redis. This gives immediate revocation, idle expiry, absolute expiry, and server-side versioning without placing customer state or long-lived bearer claims in the browser. The session cookie is `HttpOnly`, `SameSite=Lax`, host-only, and `Secure` in production. A separate random non-sensitive cookie supports double-submit CSRF; state-changing authenticated requests must present the matching `x-csrf-token` value.

PINs use salted Argon2id hashes with an explicit cost profile. OTP values are stored only as keyed digests, have short TTLs, attempt limits, cooldowns, rate limits, and one-time consumption. Local demo OTP responses make deterministic backend testing possible, but production configuration rejects demo mode.

Passkeys use WebAuthn through `@simplewebauthn/server`. Redis-bound challenges are tied to user/session or request context and consumed before verification, while PostgreSQL stores only public credentials, counters, and safe metadata. Discoverable credentials and user verification are required.

## Consequences

Authentication continues to work as a clear service boundary and can be scaled, audited, and unavailable independently. The Gateway must map Identity failure to 503 and cannot retry state-changing authentication calls. Redis becomes security-critical session state, so availability, access control, TTL enforcement, and revocation tests are required. The shared internal token is suitable only for local/CI development; future deployment must use rotated workload credentials, mTLS, or platform workload identity.
