# SABCL operations runbook

## At a glance

|              |                                                               |
| ------------ | ------------------------------------------------------------- |
| Service      | `@aegis/sabcl-router`, port **4103**                          |
| Liveness     | `GET /health/live`                                            |
| Readiness    | `GET /health/ready`                                           |
| Status       | `GET /sabcl/v1/status` (also at `/app/sabcl` via the gateway) |
| Ingress      | `POST /sabcl/v1/messages` — the only routing path             |
| Dependencies | Redis (replay state), the recipient services                  |

## Starting and stopping

```bash
pnpm infra:up            # PostgreSQL and Redis
pnpm build
pnpm stack:start         # starts the router between the services and the gateway
# Ctrl+C stops every service
pnpm infra:down          # stops containers
```

The stack script skips the router when `SABCL_MODE=off`, because the router
refuses to start in that mode and there would be nothing to route.

Run the router alone:

```bash
pnpm --filter @aegis/sabcl-router build
pnpm --filter @aegis/sabcl-router start
```

## Health

```bash
curl -s http://127.0.0.1:4103/health/ready
```

```json
{ "status": "ok", "replayState": "ok" }
```

`"status": "degraded"` with `"replayState": "unavailable"` means Redis is
unreachable. The router **fails closed** in that state: envelopes are not
forwarded. Replay protection is not optional, and forwarding without a claim
would silently permit duplicate transfers.

## Reading the status

```bash
curl -s http://127.0.0.1:4103/sabcl/v1/status | jq
```

| Field            | Meaning                                                |
| ---------------- | ------------------------------------------------------ |
| `mode`           | `strict`, `compatible` or `off`                        |
| `routerKey`      | Abbreviated fingerprint, e.g. `sabcl-router.v1:44ab02` |
| `rotation[]`     | Per service: active, accepted and revoked key versions |
| `routes[]`       | Live capability names                                  |
| `reachability[]` | Whether each capability's service answers              |
| `counters`       | Envelope outcomes since start                          |
| `replayState`    | Redis reachability                                     |

No key material, no route tokens, no destination URLs, no payloads.

## Counters and what they mean

| Counter                 | Rising means                                          |
| ----------------------- | ----------------------------------------------------- |
| `envelope.accepted`     | Normal traffic                                        |
| `envelope.replayed`     | Duplicate submission, a retry storm, or an attack     |
| `envelope.expired`      | Clock skew between services, or heavy latency         |
| `signature.invalid`     | Tampering, or a key mismatch after a botched rotation |
| `route.invalid`         | Unknown/revoked route, or a rate limit being hit      |
| `recipient.unavailable` | The destination service is down or slow               |
| `hop.exhausted`         | Misconfigured hop limit                               |
| `envelope.rejected`     | Malformed input                                       |

## Diagnosing

Every audit line is JSON with a stable `event`. Message and route identifiers
appear as salted 12-character digests, so two lines about the same message
correlate without the log being a lookup table back to the wire.

```json
{
  "event": "envelope.replayed",
  "messageDigest": "25e5ca235057",
  "routeDigest": "47fde8407e9f",
  "senderKeyId": "gateway.v1",
  "reason": "SABCL_REPLAYED",
  "durationMs": 0,
  "at": "..."
}
```

### `SABCL_SIGNATURE_INVALID` after a rotation

Almost always a rotation done in the wrong order. The public half must be
published to every peer **before** the owning service switches to the new key.
Check the rotation table: if a service is _sending_ under a version that peers do
not list as accepted, that is the fault. Re-add the version to `SABCL_PEERS`
everywhere and restart.

### `SABCL_ROUTE_INVALID` for a route that should work

1. `curl .../sabcl/v1/status | jq .routes` — is it listed? If not it is revoked
   or absent from `SABCL_ROUTES`.
2. Is `SABCL_ROUTE_SECRET` identical on the sender and the router? A mismatch
   makes every derived token a lookup miss.
3. Is the rate limit being hit? `SABCL_RATE_LIMIT_PER_MINUTE` rejections use this
   same code.

### `SABCL_EXPIRED` in bursts

Clock skew. Tolerance on `iat` is 5 seconds and there is none on `exp`. Check NTP
on every host. Do not raise `SABCL_MAX_TTL_SECONDS` to paper over it — that
widens the replay window.

### `SABCL_RECIPIENT_UNAVAILABLE`

The router could not reach the destination, or the destination returned something
that was not a valid sealed response. Check `reachability` in the status output
and the recipient's own health. The router deliberately does not relay the
recipient's error detail, so diagnose at the recipient.

### Strict mode will not start

The message names the specific failure. Common causes:

- placeholder material still in `.env` (`change-me`, `example-only`, …);
- deterministic test fixture material — refused by design;
- `SABCL_ROUTE_SECRET` shorter than 32 bytes;
- `SABCL_<SERVICE>_KEY_ID` naming a different service than the one loading it;
- `SABCL_PEERS` not a valid JSON array.

Generate real material with `pnpm sabcl:keys -- --service <name>`.

## Incident response

### Suspected key compromise

1. **Revoke immediately.** Mark the key `"revoked": true` in `SABCL_PEERS` on
   every peer and restart. Messages under it are rejected at once.
2. **Ensure a replacement exists first**, or the service becomes unaddressable.
   If none is configured, generate and publish the next version before revoking.
3. **Assess exposure.** A compromised _signing_ key allows forged messages from
   that service. A compromised _encryption_ key allows decryption of traffic
   captured while it was live — SABCL's forward secrecy is one-sided.
4. **Rotate the route secret too** if the same store held it.

### Suspected router compromise

The router cannot read payloads or forge messages — that is the design. Assume it
learned:

- which service pairs communicated, when, how often, and roughly how large;
- which capability each message targeted, if it held the route secret.

Assume it could **drop or delay** traffic. It could not double-spend: the
recipient holds its own replay claim.

Actions: rebuild the router host; rotate `SABCL_ROUTE_SECRET`; note that audit
digests will not correlate across the rotation.

### Replay counter spiking

Distinguish a retry storm from an attack: a storm shows the same
`messageDigest` repeatedly from a legitimate `senderKeyId` alongside healthy
`envelope.accepted`. An attack usually shows many distinct digests, or digests
that stopped being accepted long ago. Rate limiting is per sender key —
`SABCL_RATE_LIMIT_PER_MINUTE`, default 600.

### Redis outage

The router reports itself unready and stops forwarding. This is intended: it
fails closed. Restore Redis; no manual replay-state repair is needed, because
entries are short-lived and self-expiring.

## Testing

```bash
pnpm sabcl:test               # protocol, crypto, padding, rotation, route tokens
pnpm sabcl:test:leakage       # metadata leakage against seeded sensitive values
pnpm sabcl:test:router        # routing, replay, rate limits
pnpm sabcl:test:integration   # router + real Redis  (needs pnpm infra:up)
pnpm sabcl:test:e2e           # strict-mode encrypted journey (needs pnpm infra:up)
```

## Related

- [Protocol specification](./sabcl-protocol.md)
- [Key management and rotation](./sabcl-key-management.md)
- [Route-token provisioning](./sabcl-route-provisioning.md)
- [Replay and expiry design](./sabcl-replay-and-expiry.md)
- [Threat model](./sabcl-threat-model.md)
