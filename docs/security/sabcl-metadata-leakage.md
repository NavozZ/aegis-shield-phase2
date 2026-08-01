# SABCL metadata leakage analysis

What an observer of SABCL traffic can and cannot determine, and how each claim is
tested.

## Method

[`packages/sabcl/src/protocol/leakage.test.ts`](../../packages/sabcl/src/protocol/leakage.test.ts)
seeds a payload with distinctively-marked values in every sensitive category,
seals it, then scans the serialised outer envelope for each value in five
encodings — raw, base64, base64url, hex and percent-encoded — including every
outer field decoded back from base64url, so a plaintext leak inside the
ciphertext field would be caught.

The envelope schema is `.strict()`, so adding an outer field is a parse failure
rather than a silent widening of what the router sees.

## Per-field analysis

| Field         | Visible to router   | Reveals                                          | Assessment                                                |
| ------------- | ------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| `v`           | `"SABCL/1"`         | Protocol version                                 | No leakage. Structural.                                   |
| `mid`         | 128-bit random      | Nothing                                          | CSPRNG. Distinguishes messages, identifies nothing.       |
| `rt`          | HMAC-SHA-256 output | Which capability, **only with the route secret** | See [route tokens](#route-tokens) below.                  |
| `skid`        | `gateway.v1`        | Which service is calling                         | Accepted leak; see [service identity](#service-identity). |
| `rkid`        | `ledger.v1`         | Which service is being called                    | Same.                                                     |
| `epk`         | X25519 public point | Nothing                                          | Fresh per message; unlinkable.                            |
| `iat` / `exp` | Unix seconds        | When the message was created                     | Accepted; the observer sees the packet timing anyway.     |
| `n`           | 96-bit random       | Nothing                                          | Fresh per message.                                        |
| `hl`          | Small integer       | Hop budget                                       | Structural. Constant in this deployment.                  |
| `pad`         | Bucket size         | Order of magnitude of the payload                | See [padding](#padding).                                  |
| `ct`          | Ciphertext          | Nothing without the key                          | AES-256-GCM.                                              |
| `tag` / `sig` | Authenticators      | Nothing                                          | —                                                         |

## Categories confirmed absent

Each is seeded and scanned:

- customer identifiers
- account identifiers
- amounts
- recipient references
- endpoint paths
- business operation names
- session/authentication assertions
- PIN authorisation data
- transaction identifiers

The same scan runs against the **response** envelope, seeded with a transaction
identifier, account identifier and amount in the response body.

## Route tokens

`HMAC-SHA-256(routeSecret, "SABCL/1 route-token" ‖ routeId)`.

- Without the secret: an opaque 256-bit value. Tested that the token contains
  neither `payments` nor `transfer`, raw or base64url-decoded, and that a
  different secret yields a different token.
- With the secret: the observer can enumerate the small capability set and match
  tokens, learning **which capability** each message targets — but not the
  payload.

Because tokens are deterministic, an observer _without_ the secret can still
count how many distinct capabilities are in use and how traffic distributes
across them. This is accepted: the alternative — randomised per-message tokens —
would require a provisioning round trip that would itself be observable.

## Service identity

`skid` and `rkid` name a key, e.g. `gateway.v1`. An observer therefore learns
which service pair is communicating.

This is an accepted, deliberate leak. Hiding it would require the router to
resolve recipients without knowing which key to hand the message to, which the
one-hop design cannot provide. It is not customer data: knowing that the gateway
called the ledger reveals nothing about _whose_ account was read.

## Padding

Payloads are padded to the smallest of 512, 1K, 2K, 4K, 8K, 16K, 32K, 64K bytes,
after a 4-byte length prefix, before encryption.

**What this hides**: the exact size of a payload within a bucket. Tested: three
payloads of visibly different lengths that share the 512-byte bucket produce
byte-identical ciphertext lengths.

**What this does not hide**: order of magnitude. A 40 KB response sits in a
different bucket from a 200-byte one, and that difference is visible. Tested
explicitly, so the limitation is asserted rather than assumed.

Most SABCL traffic in this system — an account read, a transfer confirmation, a
step-up verification — fits the 512-byte bucket, so those operations are not
distinguishable by size. A long transaction history is.

## Response indistinguishability

A response for a resource that exists and one for a resource that does not:

- carry the same HTTP status from the router (200, sealed);
- occupy the same padding bucket;
- differ only inside the ciphertext.

Tested in
[`sabcl-recipient.test.ts`](../../packages/sabcl/src/server/sabcl-recipient.test.ts)
and in the strict-mode journey.

## Operational logs

The router's audit records contain the event name, salted truncated digests of
the message id and route token, the sender key identifier, a protocol reason
code and a duration. Never a payload, never a wire-value message id or route
token, never key material.

Digests are salted with the route secret, so they are stable within a deployment
— an operator can correlate two log lines about the same message — and
meaningless outside it. Truncation to 12 hex characters keeps logs readable;
collisions are irrelevant because these values are only compared, never resolved.

Tested: `logs privacy-safe records: digests, never wire values` and `does not log
the router private key or the route secret` in
[`router.service.spec.ts`](../../services/sabcl-router/src/routing/router.service.spec.ts).

## Operator status surface

The status contract in
[`packages/contracts/src/sabcl/v1.ts`](../../packages/contracts/src/sabcl/v1.ts)
is `.strict()` and constrains key fields to the abbreviated fingerprint pattern
`<service>.v<n>:<6 hex>`. A raw 32-byte key is 43 base64url characters and
matches no fingerprint pattern, so key material cannot pass validation even by
mistake. Route tokens, destination URLs and payloads have no field at all.

## Summary

| Question an observer asks      | Answerable?                |
| ------------------------------ | -------------------------- |
| Is traffic flowing?            | Yes                        |
| Between which two services?    | Yes                        |
| How often, and when?           | Yes                        |
| Roughly how large?             | Yes, to a bucket           |
| Exactly how large?             | No                         |
| Which capability?              | Only with the route secret |
| Which endpoint or operation?   | No                         |
| Which customer?                | No                         |
| Which account?                 | No                         |
| What amount?                   | No                         |
| Which recipient?               | No                         |
| Did the resource exist?        | No                         |
| What did the response contain? | No                         |
