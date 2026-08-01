# SABCL key management and rotation

## Identities

Each service holds two key pairs under one identifier:

- **X25519 encryption key** — lets others send it confidential payloads.
- **Ed25519 signing key** — lets others attribute a message to it.

They are separate so a signing key can be rotated after a compromise without
invalidating in-flight encrypted material, and so a service that only needs to
verify senders never has to hold decryption material.

A key identifier is `<service>.v<version>`; the version is the rotation counter.

| Service      | Identifier        | Environment prefix |
| ------------ | ----------------- | ------------------ |
| API Gateway  | `gateway.v1`      | `SABCL_GATEWAY_`   |
| Identity     | `identity.v1`     | `SABCL_IDENTITY_`  |
| Ledger       | `ledger.v1`       | `SABCL_LEDGER_`    |
| Payments     | `payments.v1`     | `SABCL_PAYMENTS_`  |
| Blind router | `sabcl-router.v1` | `SABCL_ROUTER_`    |

Plus one deployment-wide `SABCL_ROUTE_SECRET`, from which route tokens derive.

## Generating keys

```bash
# One service identity (prints private material and the public peer entry)
pnpm sabcl:keys -- --service gateway --version 1

# The deployment-wide route secret
pnpm sabcl:keys -- --route-secret
```

Nothing is written to disk. Piping the output into a file is a decision you make
explicitly.

A full local set:

```bash
for service in gateway identity ledger payments sabcl-router; do
  pnpm sabcl:keys -- --service "$service" --version 1
done
pnpm sabcl:keys -- --route-secret
```

Put the `SABCL_<SERVICE>_*` lines in your ignored `.env`, and collect the public
JSON entries into the `SABCL_PEERS` array.

## Configuration

Each service reads its own private material and the shared peer list:

```
SABCL_MODE=strict
SABCL_ROUTE_SECRET=<base64url, ≥32 bytes>

SABCL_LEDGER_KEY_ID=ledger.v1
SABCL_LEDGER_ENCRYPTION_PRIVATE_KEY=<base64url 32 bytes>
SABCL_LEDGER_SIGNING_PRIVATE_KEY=<base64url 32 bytes>

SABCL_PEERS=[{"keyId":"gateway.v1","encryptionPublicKey":"...","signingPublicKey":"..."}, ...]
```

`SABCL_PEERS` entries accept two optional fields:

- `"revoked": true` — rejected immediately, with no fallback to an older version.
- `"notAfter": <unix seconds>` — rejected after that instant.

## Startup validation

In `strict` mode the process **fails to start** when:

- any of key id, encryption key, signing key, peer list or route secret is absent;
- key material is not a valid 32-byte X25519 or Ed25519 scalar;
- the route secret decodes to fewer than 32 bytes;
- the peer list is not a valid JSON array of public identities;
- a value matches a placeholder pattern (`change-me`, `local-only`,
  `placeholder`, `example-only`, `not-a-secret`, `fixture`);
- the material is one of the deterministic test fixtures;
- the key identifier names a different service than the one loading it.

`compatible` mode applies the same structural checks but permits placeholder
material, and is itself refused when `NODE_ENV=production`.

### Why fixture detection is not a pattern match

The test fixtures are raw base64url of a SHA-256 hash. They are
indistinguishable from real random key material by inspection, so no regular
expression can catch them. `isFixtureMaterial` instead recomputes what a fixture
for the configured key identifier _would_ be and compares — which works for any
service name, needs no maintained denylist, and never fires on genuinely random
material. See
[`packages/sabcl/src/testing/fixtures.ts`](../../packages/sabcl/src/testing/fixtures.ts).

## Rotation

Rotation is expressed by holding more than one version for a service. The
**highest live version is used to send**; **every configured version is accepted
to receive**. That asymmetry is what makes a rolling rotation safe.

### Procedure

1. **Generate the next version.**

   ```bash
   pnpm sabcl:keys -- --service ledger --version 2
   ```

2. **Publish the public half first.** Add `ledger.v2` to `SABCL_PEERS` on every
   service that talks to the ledger, and restart them. They now _accept_ both
   `ledger.v1` and `ledger.v2`, and still _address_ `ledger.v1` — nothing has
   changed on the wire yet.

3. **Switch the owning service over.** Set `SABCL_LEDGER_KEY_ID=ledger.v2` and
   its new private keys, then restart the ledger. Senders now address `ledger.v2`
   because it is the highest live version.

4. **Drain.** Wait at least `SABCL_MAX_TTL_SECONDS` (120s) so no message sealed
   to `ledger.v1` is still in flight.

5. **Retire `ledger.v1`.** Remove it from `SABCL_PEERS` and restart.

Steps 2 and 3 must not be reversed. Switching the owner first would have it
sending messages addressed to a key no peer has yet accepted.

Verify at each step on `/app/sabcl`: the rotation table shows which version is
active and which are still accepted.

### Emergency revocation

For a suspected compromise, do not wait to drain. Mark the key revoked on every
peer:

```json
{
  "keyId": "ledger.v1",
  "encryptionPublicKey": "...",
  "signingPublicKey": "...",
  "revoked": true
}
```

and restart. Messages under that key are rejected immediately with
`SABCL_KEY_REVOKED`. Ensure a live replacement version exists first, or the
service becomes unaddressable.

### Rotating the route secret

The route secret is deployment-wide, so it cannot be rotated by halves: every
sender and the router must change together. Stop traffic, update
`SABCL_ROUTE_SECRET` everywhere, restart. Note that audit-log digests are salted
with it, so digests before and after a rotation will not correlate.

## Handling rules

- Private keys come from environment configuration or a secret store. Never a
  commit, never a log, never a health response, never the status page.
- The stack script redacts every `SABCL_*_PRIVATE_KEY` and `SABCL_ROUTE_SECRET`
  from service output.
- Identities are held as Node `KeyObject`s, which do not serialise their
  material — that is why they are stored that way rather than as strings.
- The operator status surface shows `<service>.v<n>:<6 hex>`. Six hex characters
  is three bytes of a 32-byte key: enough to compare two deployments, far too
  little to reconstruct anything.

## Related

- [Protocol specification](./sabcl-protocol.md)
- [Route-token provisioning](./sabcl-route-provisioning.md)
- [Operations runbook](./sabcl-runbook.md)
