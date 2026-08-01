# SABCL/1 protocol specification

The Security-Aware Blind Communication Layer is an internal privacy layer for
service-to-service calls. Its purpose is narrow and worth stating precisely: a
router in the middle of the path can decide **where** a message goes without
learning **what** it says or **whom** it concerns.

Everything below describes what is implemented in this repository. Section
[Limitations](#limitations) states what it does not do.

---

## 1. Overview

```
Gateway                    Blind router                  Recipient service
   |                            |                                |
   |  sealed envelope           |                                |
   |--------------------------->|                                |
   |                            |  same envelope, unmodified     |
   |                            |------------------------------->|
   |                            |                                |  decrypt
   |                            |                                |  dispatch
   |                            |    sealed response             |  (loopback)
   |                            |<-------------------------------|
   |  sealed response           |                                |
   |<---------------------------|                                |
```

The router holds **no recipient decryption key**. Its configuration maps opaque
route tokens to destination URLs — not to keys — so the ciphertext is opaque
bytes to that process by construction, not by policy.

| Element              | Implementation                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Protocol package     | [`packages/sabcl/`](../../packages/sabcl/)                                                       |
| Blind router         | [`services/sabcl-router/`](../../services/sabcl-router/)                                         |
| Sender adapter       | [`apps/api-gateway/src/sabcl/`](../../apps/api-gateway/src/sabcl/)                               |
| Recipient adapters   | `services/{identity,ledger,payments}/src/sabcl/`                                                 |
| Capability catalogue | [`packages/sabcl/src/catalog/capabilities.ts`](../../packages/sabcl/src/catalog/capabilities.ts) |

---

## 2. Cryptographic construction

Per request, using Node's maintained `node:crypto`:

```
epk, esk  ←  fresh X25519 key pair (one message, then discarded)
ss        ←  X25519(esk, recipient encryption public key)
k         ←  HKDF-SHA-256(ikm = ss, salt = nonce,
                          info = "SABCL/1 request-key" ‖ canonical header)
ct, tag   ←  AES-256-GCM(k, nonce, pad(payload), aad = canonical header)
sig       ←  Ed25519(sender signing key,
                     "SABCL/1 request-signature" ‖ header ‖ ct ‖ tag)
```

The response reuses `ss` with a different HKDF domain tag
(`SABCL/1 response-key`) and a fresh nonce, so request and response keys are
unrelated and neither can be substituted for the other.

**Primitives**: X25519 ECDH, HKDF-SHA-256, AES-256-GCM (96-bit nonce, 128-bit
tag), Ed25519. No custom cryptography. No ECB, no unauthenticated encryption, no
static nonces, no passwords as keys.

**Key separation**: each service holds an X25519 _encryption_ identity and an
Ed25519 _signing_ identity. They are separate so a signing key can be rotated on
compromise without invalidating in-flight encrypted material, and so a service
that only verifies senders never needs decryption material.

### Canonical encoding

Signed and authenticated material is encoded as `uint32be(length) ‖ bytes` per
field in fixed positional order — not JSON. A length-prefixed encoding has
exactly one representation per field vector, so `["ab","c"]` and `["a","bc"]`
cannot collide. See [`protocol/canonical.ts`](../../packages/sabcl/src/protocol/canonical.ts).

---

## 3. The outer envelope

**This is the privacy boundary.** Every field here is visible to the router. The
rule is that an outer field must be either opaque (random or HMAC-derived) or
purely structural (version, time, size).

| Field  | Type             | Meaning                            | Why it is safe to expose                       |
| ------ | ---------------- | ---------------------------------- | ---------------------------------------------- |
| `v`    | `"SABCL/1"`      | Protocol version                   | Structural                                     |
| `mid`  | base64url        | 128-bit message id                 | CSPRNG; replay key and response correlator     |
| `rt`   | base64url        | Route token                        | HMAC-derived; not reversible to a service name |
| `skid` | `<service>.v<n>` | Sender key id                      | Names a key, never a customer                  |
| `rkid` | `<service>.v<n>` | Recipient key id                   | Names a key, never a customer                  |
| `epk`  | base64url        | Sender ephemeral X25519 public key | Single-use public value                        |
| `iat`  | integer          | Creation time, unix seconds        | Structural                                     |
| `exp`  | integer          | Expiry, unix seconds               | Structural                                     |
| `n`    | base64url        | 96-bit AES-GCM nonce               | Random                                         |
| `hl`   | integer          | Remaining hops                     | Structural                                     |
| `pad`  | integer          | Padded plaintext length            | Bucket, not exact size                         |
| `ct`   | base64url        | AES-256-GCM ciphertext             | Encrypted                                      |
| `tag`  | base64url        | GCM authentication tag             | —                                              |
| `sig`  | base64url        | Ed25519 signature                  | —                                              |

**Absent by design**: endpoint paths, business operation names, customer
identifiers, account identifiers, amounts, recipient references, authentication
assertions, transaction details and PIN authorisation data. All of those live
inside `ct`.

The schema is `.strict()`, so an added field is a parse failure rather than a
silent leak. [`leakage.test.ts`](../../packages/sabcl/src/protocol/leakage.test.ts)
seeds each of those categories into a payload and asserts none appears anywhere
in the serialised envelope — as a raw string, base64, base64url, hex or
percent-encoded.

### Response envelope

Narrower: `v`, `cid` (correlates to the request's `mid`), `skid`, `n`, `pad`,
`ct`, `tag`, `sig`. No route token and no hop limit, because a response returns
on the connection its request arrived on. `cid` is an opaque value the router
already saw, so correlation costs no additional metadata.

---

## 4. Security properties

| Property                | Mechanism                                                   |
| ----------------------- | ----------------------------------------------------------- |
| Payload confidentiality | ECDH to the recipient's key; the router has none            |
| Payload integrity       | AES-GCM tag over ciphertext                                 |
| Sender authenticity     | Ed25519 signature by a key the recipient has configured     |
| Recipient binding       | `rkid` in the AAD **and** ECDH against that recipient's key |
| Route binding           | `rt` in the AAD; swapping it breaks both tag and signature  |
| Expiry enforcement      | `exp` in the AAD, checked before any key is touched         |
| Replay prevention       | `mid` claimed atomically in Redis (`SET NX EX`)             |
| Bounded size            | 64 KiB plaintext, 256 KiB envelope, enforced before parsing |
| Bounded hops            | `hl` ∈ [0, 4], rejected at 0                                |
| Key versioning          | `<service>.v<n>`; multiple versions accepted concurrently   |
| Response correlation    | `cid` = request `mid`; opaque, never a business identifier  |
| Padding                 | Buckets: 512, 1K, 2K, 4K, 8K, 16K, 32K, 64K bytes           |
| Safe errors             | Fixed protocol codes; existence never observable            |
| Forward secrecy         | Ephemeral `esk` discarded after sealing (one-sided)         |

### Why the router does not verify signatures

It could — it holds the sender's public key. It deliberately does not, because
if the router were the only element checking authenticity, a compromised router
could accept or drop traffic on a criterion the recipient never re-checks. The
**recipient** verifies, so a router that lies about authenticity is caught at the
far end. The router checks only what it must to route safely: version, freshness,
sender-key allowlist, hop budget, rate limit, route resolution and replay.

### Error taxonomy

Codes are coarse on purpose. Unknown sender, unknown recipient, revoked key,
invalid signature and failed decryption **all map to HTTP 401**, so probing with
different key identifiers reveals nothing about which check failed. A message
addressed to a customer that exists and one addressed to a customer that does not
fail identically at this layer — the difference is only ever visible inside the
recipient, under encryption.

---

## 5. Route tokens

```
routeToken = base64url(HMAC-SHA-256(routeSecret, "SABCL/1 route-token" ‖ routeId))
```

A route identifier names a **capability** (`ledger.accounts`), not a path. The
mapping from capability to concrete internal paths lives only in the recipient.

Properties:

- **Irreversible** — an observer cannot recover `payments` or
  `/internal/customer-transfers` from a token.
- **Deterministic** — sender and router derive the same token from the shared
  secret, with no provisioning round trip.
- **Allowlist-bound** — the router recognises only tokens it derived itself from
  its own configured route table at startup.

**The router is therefore not a general HTTP proxy.** There is no request shape
that names a destination: the nearest thing is `rt`, and that is a lookup key
into a table built at startup. An attacker-chosen token is a lookup miss, not a
URL. Resolution compares every candidate in constant time and always runs the
full loop, so an unknown token and a revoked one are indistinguishable by timing
as well as by code.

---

## 6. Capabilities and the confused-deputy defence

A route token authorises a capability. It does **not** authorise every internal
path the recipient exposes. Each capability declares anchored path patterns; the
recipient rejects a decrypted request whose path falls outside them, before
dispatch.

| Capability          | Service  | Reaches                                                 |
| ------------------- | -------- | ------------------------------------------------------- |
| `identity.step-up`  | identity | `/api/v1/auth/transfer-step-up`, `/api/v1/auth/session` |
| `ledger.accounts`   | ledger   | customer account and transaction reads                  |
| `ledger.postings`   | ledger   | `/internal/customer-transfers[/preview]`                |
| `payments.transfer` | payments | transfer policy, intents, confirmation, listing         |

Reads and postings are separate capabilities so a token that permits listing
accounts does not also permit moving money. Reconciliation, recovery, journal
entries, onboarding, PIN creation, passkey registration and logout have **no
SABCL route** — they stay on their existing paths.

Without the path check, any holder of any valid key and any valid route token
could reach any internal endpoint of the recipient. That is the confused-deputy
problem, and the allowlist is the defence.

---

## 7. Dispatch

After decryption and the capability check, the recipient replays the request
against its own HTTP surface on loopback, carrying the internal token it would
have carried had the gateway called directly.

This is deliberate. Every existing guard, validation pipe, exception filter and
contract check runs exactly as before, so a SABCL-routed call and a direct call
cannot drift apart in behaviour. The cost is one loopback request per call; the
alternative — reaching into controllers directly — would bypass the guards and
create two code paths to keep in agreement.

The customer identifier arrives _encrypted_ in the payload and is re-attached as
a header only inside the recipient's own process.

---

## 8. Modes

| Mode         | Behaviour                                                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `strict`     | Every integrated call is encrypted and routed. Startup fails on missing, invalid, placeholder or fixture key material. No fallback: a router outage is an outage. |
| `compatible` | SABCL is used when it can be, with a documented fallback to the direct internal path. **Refused when `NODE_ENV=production`.**                                     |
| `off`        | SABCL is not wired in; existing behaviour is unchanged.                                                                                                           |

There is no automatic downgrade from strict, and the tests assert it: see
`does not fall back to plaintext when strict and the router is down` in
[`ledger.client.sabcl.spec.ts`](../../apps/api-gateway/src/accounts/ledger.client.sabcl.spec.ts).

Strict mode also refuses the deterministic test fixtures. That check cannot be a
string pattern — the fixture keys are raw base64url of a hash and are
indistinguishable from real random bytes by inspection — so it recomputes the
fixture for the configured key identifier and compares. See `isFixtureMaterial`.

---

## 9. Limitations

Stated plainly, because a status page full of green pills should not imply more
than this delivers.

**Not protected against:**

- **A compromised endpoint after decryption.** Once the recipient has decrypted
  a payload, SABCL offers nothing further. An attacker with code execution in
  the ledger service reads ledger data.
- **Traffic analysis beyond the implemented padding.** Bucketing hides exact
  payload size within a bucket, and nothing more. Message timing, frequency,
  direction and order-of-magnitude size remain observable to the router and to
  anyone on the network. A caller sending 40 KB is still distinguishable from
  one sending 200 bytes.
- **Internet-level anonymity.** This is an internal layer between known services
  on a known network. It is not an anonymity network.
- **Hardware key protection.** Keys are held in process memory, loaded from
  environment configuration. No HSM, no secure enclave, no key attestation.
- **A malicious router dropping traffic.** The router cannot read or forge
  messages, but it can refuse to forward them. SABCL provides confidentiality
  and authenticity, not availability.
- **Compromise of the route secret.** An attacker who obtains `SABCL_ROUTE_SECRET`
  can derive route tokens and learn which capability a captured envelope
  targeted. They still cannot read the payload.

**One-sided forward secrecy.** The sender's ephemeral key is discarded after
sealing, so a later compromise of the recipient's long-term key does not decrypt
captured traffic. The recipient's static key is still required to decrypt at the
time of receipt.

---

## 10. Related documents

- [Cryptographic design decision (ADR 0009)](../decisions/0009-sabcl-privacy-and-secure-routing.md)
- [Threat model](./sabcl-threat-model.md)
- [Metadata leakage analysis](./sabcl-metadata-leakage.md)
- [Replay and expiry design](./sabcl-replay-and-expiry.md)
- [Key management and rotation](./sabcl-key-management.md)
- [Route-token provisioning](./sabcl-route-provisioning.md)
- [Operations runbook](./sabcl-runbook.md)
- [Router service README](../../services/sabcl-router/README.md)
- [Demo guide](../demo/sabcl-routing-demo.md)
