# SABCL threat model

Scope: service-to-service traffic between the API Gateway and the Identity,
Ledger and Payments services, routed through the blind router. Everything
outside that path — browser sessions, CSRF, PIN step-up, database integrity — is
covered by the earlier threat models and is unchanged by this phase.

## Assets

| Asset                     | Where it lives                         | Exposure before SABCL            |
| ------------------------- | -------------------------------------- | -------------------------------- |
| Customer identifier       | URL path, `x-aegis-customer-id` header | Clear on the internal network    |
| Account identifier        | URL path, request body                 | Clear                            |
| Transfer amount           | Request body                           | Clear                            |
| Recipient reference       | Request body                           | Clear                            |
| PIN authorisation data    | Request body                           | Clear                            |
| Operation being performed | URL path and method                    | Clear                            |
| Service identities        | Shared bearer token                    | Interchangeable between services |

## Trust boundaries

```
  browser  ─┬─►  gateway  ─────►  blind router  ─────►  recipient  ─►  database
            │   (trusted,        (SEMI-TRUSTED:        (trusted,
            │    holds keys)      routes, cannot        holds keys)
            │                     read)
            └── untrusted
```

The blind router is the boundary this phase introduces. It is deliberately the
least-trusted server-side element: it must be able to route, and it must not be
able to read.

## Adversaries

### A1 — Passive observer on the internal network

_Can capture every byte between gateway, router and services._

| Learns                                                     | Does not learn                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| That a message was sent, when, and how large (to a bucket) | Any payload content                                           |
| Which sender key and recipient key were used               | Which customer, account or amount                             |
| An opaque route token                                      | Which capability the token selects (without the route secret) |
| Message and response counts, timing, direction             | Which operation was invoked                                   |

Mitigation: authenticated encryption; opaque outer envelope; padding buckets.
**Residual risk**: timing, frequency and order-of-magnitude size are observable.
Traffic analysis is not defeated.

### A2 — Active network attacker

_Can modify, replay, reorder, drop and inject._

| Attempt                         | Outcome                                                     |
| ------------------------------- | ----------------------------------------------------------- |
| Modify ciphertext               | GCM tag and signature both fail → `SABCL_SIGNATURE_INVALID` |
| Swap the route token            | `rt` is in the AAD → tag and signature fail                 |
| Re-address to another recipient | `rkid` in AAD and ECDH mismatch → fails                     |
| Replay a captured envelope      | `mid` already claimed → `SABCL_REPLAYED`                    |
| Replay after expiry             | `exp` checked before any key touched → `SABCL_EXPIRED`      |
| Extend the lifetime             | `exp` in AAD → fails                                        |
| Raise the hop limit             | `hl` in AAD → fails                                         |
| Forge a sender identity         | No signing key → signature fails                            |
| Inject a fabricated envelope    | Same                                                        |
| Drop messages                   | **Succeeds.** SABCL does not provide availability.          |

Every one of these has a test in
[`seal.test.ts`](../../packages/sabcl/src/protocol/seal.test.ts).

### A3 — Compromised blind router

_Full control of the router process, its configuration and its Redis._

| Attempt                                    | Outcome                                                          |
| ------------------------------------------ | ---------------------------------------------------------------- |
| Read a payload                             | **Cannot.** Holds no recipient decryption key.                   |
| Forge a message                            | **Cannot.** Holds no sender signing key; the recipient verifies. |
| Modify a message in flight                 | Detected at the recipient                                        |
| Redirect to a different service            | Would need to re-seal to that service's key                      |
| Learn which capability a message targets   | **Succeeds** — it holds the route secret                         |
| Learn traffic patterns per sender key      | **Succeeds**                                                     |
| Drop or delay traffic                      | **Succeeds**                                                     |
| Suppress replay state to permit duplicates | Recipient holds its own replay claim → still rejected            |

This is why the recipient verifies signatures and keeps its own replay store: so
that a router compromise degrades to a denial-of-service and a metadata leak,
not to a forgery or a double-spend.

### A4 — Attacker with a valid route token and key

_e.g. a compromised gateway, or a stolen service identity._

| Attempt                                                | Outcome                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| Reach any internal path of the recipient               | **Blocked** by the capability path allowlist                       |
| Use a read token to post a transfer                    | **Blocked** — `ledger.accounts` and `ledger.postings` are separate |
| Reach reconciliation, recovery or journal entries      | **Blocked** — no SABCL route exists                                |
| Reach onboarding, PIN creation or passkey registration | **Blocked** — no SABCL route exists                                |
| Path traversal, raw or percent-encoded                 | **Blocked** — decoded and checked before matching                  |
| Change origin via `//host/path`                        | **Blocked** — loopback dispatch re-checks origin                   |
| Perform operations within its own capability           | **Succeeds.** A compromised gateway can do what a gateway can do.  |

### A5 — Attacker probing for resource existence

| Attempt                                                     | Outcome                                                                                                          |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Distinguish a real customer from a fake one via status code | **Blocked** — the upstream status travels sealed                                                                 |
| Distinguish via error code                                  | **Blocked** — fixed protocol codes only                                                                          |
| Distinguish via response size                               | **Blocked** — responses are padded to buckets                                                                    |
| Distinguish which auth check failed via status              | **Blocked** — unknown sender, unknown recipient, revoked key, bad signature and failed decryption all return 401 |
| Distinguish unknown from revoked route by timing            | **Blocked** — constant-time comparison, full loop always runs                                                    |

### A6 — Attacker with a captured route secret

| Learns                                 | Does not learn                               |
| -------------------------------------- | -------------------------------------------- |
| Which capability each envelope targets | Any payload content                          |
| Can derive valid route tokens          | Cannot pass recipient signature verification |

Route-secret compromise is a metadata leak, not a confidentiality break. Rotation
procedure: [key management](./sabcl-key-management.md).

### A7 — Browser-originated attacker

| Attempt                                 | Outcome                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| Construct a SABCL envelope              | **Cannot** — no cryptographic API is shipped to the client bundle            |
| Reach the router directly               | The router is bound to loopback and is not exposed through the gateway       |
| Reach `/sabcl/v1/inbound` on a service  | Needs a signing key it does not have                                         |
| Read keys from the operator status page | **Cannot** — the strict status contract admits only abbreviated fingerprints |

## Assumptions

1. Private keys in environment configuration are protected by the deployment's
   secret management. This repository ships placeholders only.
2. Redis is reachable and not attacker-controlled. If it is unreachable the
   router reports itself unready rather than forwarding possible duplicates.
3. Service clocks agree within `SABCL_CLOCK_SKEW_SECONDS` (5s). Larger skew
   causes false `SABCL_EXPIRED` rejections — a fail-closed outcome.
4. The loopback interface is not observable by the adversary. Dispatch decrypts
   and calls `127.0.0.1`; an attacker who can sniff loopback is already inside
   the recipient's trust boundary.
5. `node:crypto` is correct. We compose standard primitives and implement none.

## Explicitly out of scope

- Compromised endpoints after decryption.
- Traffic analysis beyond the padding buckets.
- Internet-level anonymity.
- Hardware key protection or key attestation.
- Availability under a hostile router.
- External payment rails; all money here is synthetic.

## Related

- [Protocol specification](./sabcl-protocol.md)
- [Metadata leakage analysis](./sabcl-metadata-leakage.md)
- [Replay and expiry design](./sabcl-replay-and-expiry.md)
- [Transfer threat model](./transfer-threat-model.md)
- [Authentication threat model](./authentication-threat-model.md)
