# SABCL replay and expiry design

## The requirement

An envelope must be accepted at most once. Without this, a captured transfer
confirmation could be resubmitted and the money moved twice — authentication
alone does not help, because the replayed message _is_ authentic.

## Expiry bounds the problem

Every envelope carries `iat` and `exp`, both inside the authenticated header, so
neither can be extended without breaking the tag and the signature.

| Setting                     | Value | Why                                           |
| --------------------------- | ----- | --------------------------------------------- |
| `SABCL_DEFAULT_TTL_SECONDS` | 30    | Comfortably longer than any internal call     |
| `SABCL_MAX_TTL_SECONDS`     | 120   | Ceiling; a longer TTL is refused at seal time |
| `SABCL_CLOCK_SKEW_SECONDS`  | 5     | Tolerance on `iat` only, never on `exp`       |

Expiry is checked **before any key material is touched**, so an expired message
costs no cryptography. A message issued more than 5 seconds in the future is
also rejected — that is either a badly skewed clock or an attempt to extend a
message's usable life.

The TTL ceiling is what makes replay state bounded: an identifier only has to be
remembered until the message carrying it would have expired anyway.

## Two independent claims

Replay is enforced **twice**, at the router and at the recipient.

```
sender ──► router                    ──► recipient
           SET NX aegis:sabcl:replay:<mid>   SET NX aegis:sabcl:<svc>:replay:<mid>
           (cheap first gate)                (authoritative)
```

Both are needed:

- The **router** is the cheaper gate. Rejecting a duplicate here costs no
  upstream request.
- The **recipient** is authoritative. Nothing stops a message being delivered
  straight to a service's `/sabcl/v1/inbound` by anything already on the internal
  network. If the recipient trusted the router's check, that direct path would
  have no replay protection at all — and a compromised router could suppress its
  own state to permit duplicates.

## Atomicity

The check must be a single operation. Two concurrent copies racing through a
read-then-write would both observe "unseen" and both be accepted — which is
exactly the duplicate-submission case that matters.

```
SET <prefix>replay:<mid> "1" NX EX <remaining lifetime + 1>
```

`SET NX EX` is one Redis command, so the claim is atomic across processes. Two
router instances behind a load balancer cannot both accept the same envelope.

Tested at three levels:

- **Unit** — `concurrent duplicates admit exactly one winner` (32 concurrent
  claims, exactly one succeeds).
- **Router unit** — `admits exactly one of a set of concurrent duplicates`, and
  the upstream fetch is called exactly once.
- **Integration, real Redis** — `shares replay state across router instances`
  and `admits exactly one concurrent duplicate across instances`, using separate
  `RouterService` instances to model separate processes.

## Ordering: authenticate, then claim

At the recipient, the replay claim happens **after** signature verification.

If it happened first, an attacker could send a forged envelope carrying a `mid`
they had observed the legitimate sender about to use, burning that identifier and
causing the real message to be rejected as a replay. Verifying first means only
an authentic message can consume an identifier.

Tested: `an unauthenticated envelope never consumes a message identifier`.

The router claims before forwarding but after its own structural checks, which is
the right trade-off there: the router cannot verify signatures by design, and
claiming late would mean paying for an upstream request per duplicate.

## Key namespacing

| Component         | Prefix                                |
| ----------------- | ------------------------------------- |
| Router            | `aegis:sabcl:` (`SABCL_REDIS_PREFIX`) |
| Ledger            | `aegis:sabcl:ledger:`                 |
| Payments          | `aegis:sabcl:payments:`               |
| Identity          | `<IDENTITY_REDIS_PREFIX>sabcl:`       |
| CI                | `aegis:sabcl:test:ci:`                |
| Integration tests | `aegis:sabcl:test:integration:`       |

Identity's SABCL state is namespaced beneath its own prefix so replay state
cannot collide with session or OTP state in a shared Redis. Test cleanup refuses
to run unless `NODE_ENV=test` and the prefix starts with an isolated test
namespace.

## Retention

The TTL on each entry is `exp - now + 1`, so state is retained for exactly as
long as the message could still be resubmitted, and no longer. With a 120-second
ceiling, worst-case retention is 121 seconds per message.

Once the window passes the identifier is released. This does not reopen a replay
window: the envelope that used it is expired by then, and the expiry check runs
before the replay check. Tested end to end in
`expires replay state so retention stays bounded by the message TTL`, which
asserts the second attempt fails with `SABCL_EXPIRED` rather than succeeding.

## Failure behaviour

If Redis is unreachable:

- `/health/ready` reports `degraded` with `replayState: "unavailable"`, so a load
  balancer stops sending traffic.
- `remember` throws, the router's catch-all converts it to a protocol error, and
  the envelope is **not forwarded**.

The router fails closed. Forwarding without a replay claim would silently permit
duplicates, which is worse than an outage.

## Nonce reuse

Distinct from replay: each message carries a fresh 96-bit CSPRNG nonce, and the
key is derived per message via HKDF salted by that nonce, so an AES-GCM
nonce/key pair is never reused even if a nonce repeated. Tested that 512
consecutive nonces are distinct and that sealing the same payload twice yields
different ciphertext.

## Related

- [Protocol specification](./sabcl-protocol.md)
- [Threat model](./sabcl-threat-model.md)
- [Payment idempotency and recovery](./payment-idempotency-and-recovery.md) —
  the business-level idempotency this complements
