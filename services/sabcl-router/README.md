# @aegis/sabcl-router

The blind router for the Security-Aware Blind Communication Layer.

It forwards encrypted service envelopes **it cannot read**. Not "does not read" —
cannot: it holds no recipient decryption key, because its configuration maps
opaque route tokens to destination URLs rather than to keys. The ciphertext is
opaque bytes to this process by construction.

## Port

**4103.** Chosen after inspecting the reservations in `.env.example`,
`infra/scripts/stack.mjs` and the CI workflow: 3000 web, 4000 gateway, 4101
identity, 4102 ledger, 4104 payments, 4105 threat detection (reserved), 4318
OTLP, 5432 PostgreSQL, 6379 Redis, 9090 metrics. 4103 is the unclaimed gap
between ledger and payments. Override with `SABCL_ROUTER_PORT`.

Binds to `127.0.0.1` by default. Nothing in a browser has any business talking to
this service; the operator status view is proxied through the gateway.

## Endpoints

| Method | Path                 | Purpose                                 |
| ------ | -------------------- | --------------------------------------- |
| `POST` | `/sabcl/v1/messages` | The only routing path                   |
| `GET`  | `/health/live`       | Liveness                                |
| `GET`  | `/health/ready`      | Readiness, including Redis reachability |
| `GET`  | `/sabcl/v1/status`   | Operator status; no secret metadata     |

One path, one method, one body shape. There is no request shape that names a
destination, a header or a query, so the router cannot be turned into a general
HTTP proxy.

## What it checks

Before forwarding, in order:

1. Byte length against `SABCL_MAX_ENVELOPE_BYTES` — before any parsing.
2. Envelope schema (`.strict()`) and protocol version.
3. Expiry, issue time and TTL ceiling — before any key material is touched.
4. Sender key against the configured allowlist.
5. Hop budget.
6. Per-sender-key rate limit.
7. Route token resolution against the startup-built table, in constant time.
8. Replay claim in Redis (`SET NX EX`), atomic across router instances.

Then it forwards the envelope **unchanged** and returns the sealed response.

## What it deliberately does not check

**Signatures.** It holds the sender's public key and could verify, but if the
router were the only element establishing authenticity, a compromised router
could accept or drop traffic on a criterion nobody re-checks. The recipient
verifies instead, so a router that lies is caught at the far end.

It also has **no internal-token guard**. There is nothing for a bearer token to
protect: authenticity is the Ed25519 signature the recipient checks, and
authorisation is the route table. A shared token here would only create a
credential that grants routing without proving anything about the sender.

## Configuration

| Variable                              | Default        | Purpose                                        |
| ------------------------------------- | -------------- | ---------------------------------------------- |
| `SABCL_MODE`                          | —              | `strict`, `compatible`; `off` refuses to start |
| `SABCL_ROUTER_PORT`                   | `4103`         | Listen port                                    |
| `SABCL_ROUTER_HOST`                   | `127.0.0.1`    | Bind address                                   |
| `SABCL_ROUTER_KEY_ID`                 | —              | e.g. `sabcl-router.v1`                         |
| `SABCL_ROUTER_ENCRYPTION_PRIVATE_KEY` | —              | base64url X25519                               |
| `SABCL_ROUTER_SIGNING_PRIVATE_KEY`    | —              | base64url Ed25519                              |
| `SABCL_PEERS`                         | —              | JSON array of peer public identities           |
| `SABCL_ROUTE_SECRET`                  | —              | ≥32 bytes; derives route tokens                |
| `SABCL_ROUTES`                        | local defaults | JSON route table                               |
| `SABCL_FORWARD_TIMEOUT_MS`            | `5000`         | Per-forward timeout                            |
| `SABCL_RATE_LIMIT_PER_MINUTE`         | `600`          | Per sender key                                 |
| `SABCL_MAX_ENVELOPE_BYTES`            | `262144`       | Ingress ceiling                                |
| `SABCL_REDIS_PREFIX`                  | `aegis:sabcl:` | Replay-state namespace                         |
| `REDIS_URL`                           | local          | Replay state                                   |

Startup fails loudly on invalid configuration. A router that cannot authenticate
senders should not start at all.

## Running

```bash
pnpm --filter @aegis/sabcl-router build
pnpm --filter @aegis/sabcl-router start
# or as part of the local stack:
pnpm stack:start
```

## Tests

```bash
pnpm sabcl:test:router        # routing, replay, rate limits, blindness
pnpm sabcl:test:integration   # + real Redis            (needs pnpm infra:up)
pnpm sabcl:test:e2e           # strict-mode journey     (needs pnpm infra:up)
```

The unit suite includes `cannot read the payload it forwards`, which seeds a
customer identifier into a payload and asserts it appears nowhere in anything the
router process touched.

## Documentation

- [Protocol specification](../../docs/security/sabcl-protocol.md)
- [ADR 0009](../../docs/decisions/0009-sabcl-privacy-and-secure-routing.md)
- [Threat model](../../docs/security/sabcl-threat-model.md)
- [Runbook](../../docs/security/sabcl-runbook.md)
- [Key management](../../docs/security/sabcl-key-management.md)
- [Route provisioning](../../docs/security/sabcl-route-provisioning.md)
