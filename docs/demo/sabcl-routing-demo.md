# SABCL privacy and secure routing demo

Shows that an account read travels from the gateway to the ledger through a
router that cannot read it.

Roughly 15 minutes. Everything is synthetic.

## Prerequisites

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm infra:up && pnpm infra:check
pnpm db:generate && pnpm db:deploy
```

## 1. Generate real key material

`.env.example` ships placeholders, which strict mode refuses. Generate a set:

```bash
for service in gateway identity ledger payments sabcl-router; do
  pnpm sabcl:keys -- --service "$service" --version 1
done
pnpm sabcl:keys -- --route-secret
```

Copy the `SABCL_*` private lines into `.env`, collect the public JSON entries
into `SABCL_PEERS`, and set `SABCL_MODE=strict`.

**Show the refusal first.** With placeholders still in place:

```bash
pnpm --filter @aegis/sabcl-router build && pnpm --filter @aegis/sabcl-router start
```

```
[sabcl-router] strict mode refuses placeholder key material
```

Talking point: it fails at startup, not on the first request. A router that
cannot authenticate senders should not be accepting traffic at all.

## 2. Start the stack

```bash
pnpm build
pnpm stack:start
```

```
[stack] starting SABCL router
[stack] SABCL router ready
[stack] Web 3000, Gateway 4000, Identity 4101, Ledger 4102, Payments 4104, SABCL router 4103
```

## 3. The operator view

Sign in at <http://localhost:3000>, then open **SABCL** in the workspace nav
(<http://localhost:3000/app/sabcl>).

Point out:

- **Mode: strict** — every integrated call is encrypted and routed.
- **Key fingerprints** — `gateway.v1:9f3c1a`. Six hex characters is three bytes
  of a 32-byte key: enough to confirm two deployments match, useless to an
  attacker.
- **Rotation table** — which version is active and which are still accepted.
- **Route health** — capability names, never destination URLs. The mapping from
  capability to host is exactly what the layer hides.
- **The scope notice** — this page is a status view, not a security control.

## 4. Watch a real call

Leave the router's output visible and load the accounts dashboard.

```json
{
  "event": "envelope.accepted",
  "messageDigest": "3d61aa70a628",
  "routeDigest": "47fde8407e9f",
  "senderKeyId": "gateway.v1",
  "durationMs": 18,
  "at": "..."
}
```

Talking point: that is everything the router recorded. No path, no customer, no
account, no amount. The message identifier is a salted digest, so two lines about
one message correlate without the log being a lookup table back to the wire.

## 5. Prove the blindness

```bash
pnpm sabcl:test:leakage
```

The test seeds a payload with marked values in every sensitive category —
customer id, account id, amount, recipient reference, endpoint path, operation
name, session assertion, PIN authorisation — then scans the serialised envelope
for each in five encodings, including every field decoded back from base64url.

```
✔ the outer request envelope contains no seeded sensitive value
✔ the outer envelope carries only the documented fields
✔ the route token is not reversible to the capability it selects
✔ the outer response envelope leaks nothing either
✔ padding hides exact payload size within a bucket
✔ padding buckets are declared honestly: a larger payload uses a larger bucket
```

That last one is deliberate. It asserts the _limitation_ — bucketing is
order-of-magnitude only.

## 6. Prove tampering fails

```bash
pnpm sabcl:test
```

```
✔ payload tampering fails
✔ route-token tampering fails
✔ signature tampering fails
✔ every authenticated header field is bound to the ciphertext
✔ wrong-recipient decryption fails
✔ wrong-sender identity fails
✔ a forged skid claiming a trusted sender fails signature verification
✔ rotated keys interoperate: v2 sender to a recipient that accepts v1 and v2
```

Route swapping is worth pausing on: `rt` is inside the signed header, so
redirecting a message to a different capability breaks both the GCM tag and the
Ed25519 signature.

## 7. Prove replay fails

```bash
pnpm sabcl:test:integration
```

```
✔ shares replay state across router instances
✔ admits exactly one concurrent duplicate across instances
✔ expires replay state so retention stays bounded by the message TTL
```

Two `RouterService` instances model two router processes behind a load balancer.
`SET NX EX` is one Redis command, so exactly one of eight concurrent copies of
the same envelope is accepted — the difference between "a transfer posts once"
and "usually posts once".

## 8. The full encrypted journey

```bash
pnpm sabcl:test:e2e
```

Real sockets at every hop: client → router → recipient → upstream.

```
✔ carries an account retrieval end to end through the blind router
✔ never exposes the payload to the router process
✔ refuses a replayed envelope across the whole path
✔ refuses a tampered envelope at the recipient, not at the router
✔ fails safely when the router is unreachable, with no plaintext fallback
✔ refuses a path outside the capability even with a valid route token
```

The last one is the confused-deputy defence: a _valid_ route token for
`ledger.accounts` still cannot reach `/internal/reconciliation/latest`.

## 9. Safe failure

Stop the router (Ctrl+C on that process) and reload the dashboard.

The page reports the service as unavailable. It does **not** silently retry over
the plaintext internal path — that would put the customer identifier back on the
wire in the clear, which is the thing this phase removed. Strict mode has no
downgrade branch.

`/app/sabcl` shows the router unreachable, with an explanation.

## 10. What this does not do

Close on the honest limits, which the status page also states:

- Nothing protects a payload after the recipient decrypts it.
- Padding hides exact size within a bucket. Timing, frequency and
  order-of-magnitude size stay visible.
- This is an internal layer between known services, not an anonymity network.
- Keys are in process memory from environment configuration. No HSM.
- A hostile router cannot read or forge, but can drop. This is confidentiality
  and authenticity, not availability.

## Cleanup

```bash
# Ctrl+C the stack
pnpm infra:down
```

## Related

- [Protocol specification](../security/sabcl-protocol.md)
- [Threat model](../security/sabcl-threat-model.md)
- [Runbook](../security/sabcl-runbook.md)
