# ADR 0009: SABCL privacy and secure routing

- Status: accepted
- Date: 2026-08-01

## Context

Internal service calls carried their sensitive material in the clear on the
internal network. `GET /internal/customers/{customerId}/accounts` puts a customer
identifier in a URL; a transfer confirmation puts an amount, a recipient
reference and PIN authorisation in a request body. Anything positioned between
the gateway and a service — a proxy, a mesh sidecar, a log aggregator, a
capturing host — learns who is transacting, with whom, for how much, and which
operation is being performed, without breaking any authentication.

Bearer-token authentication does not help here. `x-aegis-internal-token` proves
"something on the internal network" and grants access to every internal route of
whichever service receives it. It says nothing about _which_ service is calling,
binds a request to no route, and provides no replay protection.

We need internal calls to keep working exactly as they do, while an element in
the middle of the path can route them without reading them.

## Decision

Introduce SABCL/1: a versioned envelope protocol plus an independent blind router
service.

**Cryptography.** X25519 ECDH to a per-message ephemeral key, HKDF-SHA-256 keyed
by the message nonce and a domain-separated canonical header, AES-256-GCM with
the header as additional authenticated data, and an Ed25519 signature over
header ‖ ciphertext ‖ tag. All via Node's `node:crypto`; no custom constructions.
Encryption and signing identities are separate key pairs so they can be rotated
independently.

**The envelope is the privacy boundary.** Outer fields are opaque or structural
only: version, random message id, HMAC-derived route token, key identifiers,
ephemeral public key, timestamps, nonce, hop limit, padding bucket, ciphertext,
tag, signature. Endpoint paths, operation names, customer and account
identifiers, amounts, recipient references and authorisation data live only
inside the ciphertext. The schema is `.strict()` and a leakage test seeds each
category and scans the serialised envelope in five encodings.

**Route tokens replace destination names.** `HMAC-SHA-256(routeSecret, domain ‖
routeId)`, deterministic so no provisioning round trip is needed, irreversible so
capture reveals nothing, and resolvable only against a table the router builds at
startup. The router exposes exactly one path and one method and has no request
shape that names a destination, so it cannot be turned into a general proxy.

**The router verifies structure, not signatures.** It checks version, freshness,
sender-key allowlist, hop budget, rate limit, route resolution and replay, then
forwards the bytes unchanged. The recipient verifies the signature. Splitting it
this way means a compromised router that lied about authenticity would be caught
at the far end rather than trusted.

**A route token authorises a capability, not the whole service.** Each capability
declares anchored path patterns and the recipient rejects anything outside them
before dispatch. Ledger reads and ledger postings are separate capabilities.
Administrative surfaces have no route at all.

**Dispatch replays the request against the service's own HTTP surface** on
loopback with its internal token, so every existing guard, pipe, filter and
contract check runs unchanged and the two paths cannot drift.

**Strict mode never downgrades.** A router outage in strict mode is an outage.
`compatible` mode permits a documented fallback and is refused when
`NODE_ENV=production`. Strict startup rejects placeholder values and — by
recomputing them — the deterministic test fixtures, which are otherwise
indistinguishable from real key material.

**Port 4103**, the unclaimed gap between Ledger (4102) and Payments (4104);
4105 is reserved for threat detection.

## Alternatives considered

- **mTLS between services.** Authenticates hosts and encrypts the transport, but
  a terminating proxy or mesh sidecar sees plaintext, and it binds nothing to a
  route or a message. Complementary, not a substitute.
- **Signed JWTs on internal calls.** Fixes sender authenticity, leaves the URL,
  body and operation in the clear. Solves a different problem.
- **Encrypting only request bodies.** Leaves the path — which carries the
  customer identifier — visible.
- **An onion-style multi-hop mixnet.** Real traffic-analysis resistance, at a
  latency and complexity cost that a synchronous banking call cannot absorb.
  Rejected; the honest position is one hop plus size padding, documented as such.
- **Verifying signatures at the router.** Would let a router compromise silently
  change what counts as authentic. Rejected in favour of end-to-end verification.

## Consequences

- The router can be operated at a lower trust level than the services behind it,
  because it structurally cannot read what it carries.
- Every SABCL call costs one extra network hop plus one loopback dispatch. In
  exchange, existing service behaviour is untouched.
- Key management is now real work: five identities, a route secret, a peer list,
  and a rotation procedure. `pnpm sabcl:keys` and
  `docs/security/sabcl-key-management.md` exist for it.
- Replay protection requires Redis. Without it the router reports itself unready
  rather than forwarding possible duplicates.
- Padding hides exact size within a bucket and nothing more. Timing, frequency
  and order-of-magnitude size stay observable, and the operator page says so.
- Keys live in process memory from environment configuration. No HSM.
- The layer protects data in transit between services. It offers nothing against
  a compromised endpoint after decryption.
