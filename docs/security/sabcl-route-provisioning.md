# SABCL route-token provisioning

## What a route is

A route binds a **capability name** to a **destination**. It is the only way to
make a destination reachable through the blind router; there is no wildcard and
no request-supplied URL.

```json
{
  "routeId": "ledger.accounts",
  "service": "ledger",
  "destination": "http://127.0.0.1:4102"
}
```

The wire token is derived, never transmitted as configuration:

```
rt = base64url(HMAC-SHA-256(SABCL_ROUTE_SECRET, "SABCL/1 route-token" ‖ routeId))
```

Both sender and router derive it independently from the shared secret, so adding
a route needs no provisioning round trip. A token an attacker invents is a lookup
miss, not a URL.

## Naming

`<service>.<capability>` — lowercase, dot-separated, no slashes. It names a
capability, not a path: `ledger.accounts`, never
`POST /internal/customer-transfers`. The mapping from capability to concrete
paths lives only in the recipient's allowlist.

## The current route table

| Route               | Service  | Default destination     | Capability covers                               |
| ------------------- | -------- | ----------------------- | ----------------------------------------------- |
| `identity.step-up`  | identity | `http://127.0.0.1:4101` | transfer step-up, session read                  |
| `ledger.accounts`   | ledger   | `http://127.0.0.1:4102` | account and transaction reads                   |
| `ledger.postings`   | ledger   | `http://127.0.0.1:4102` | customer transfer preview and posting           |
| `payments.transfer` | payments | `http://127.0.0.1:4104` | transfer policy, intents, confirmation, listing |

Ledger reads and ledger postings are separate routes so a token that permits
listing accounts does not also permit moving money.

## Configuring

The router uses the defaults above, derived from `IDENTITY_SERVICE_URL`,
`LEDGER_SERVICE_URL` and `PAYMENTS_SERVICE_URL`, unless `SABCL_ROUTES` is set:

```
SABCL_ROUTES=[{"routeId":"ledger.accounts","service":"ledger","destination":"http://ledger.internal:4102"},{"routeId":"payments.transfer","service":"payments","destination":"http://payments.internal:4104"}]
```

Parsing failures are fatal. A router that came up with a half-understood table
would silently stop serving a capability.

Validation at startup rejects a table that is empty, contains a malformed route
identifier, contains a non-HTTP(S) destination, or contains a duplicate.

## Adding a capability

1. **Extend the catalogue.** Add an entry to `SABCL_CAPABILITIES` in
   [`packages/sabcl/src/catalog/capabilities.ts`](../../packages/sabcl/src/catalog/capabilities.ts)
   with the route identifier, owning service and anchored path patterns.

   Both sender and recipient read this one constant, which is the point: a route
   the gateway could address but the recipient did not allow would fail in
   production and pass in a test that mocked one side.

2. **Check the patterns.** Every pattern must be anchored `^…$`. Identifier
   segments use `[A-Za-z0-9_-]{1,128}`, which cannot contain a path separator.
   `capabilities.test.ts` asserts anchoring, that intended paths match, and that
   administrative paths do not.

3. **Add the route to the router's table** (or rely on the defaults).

4. **Call it** from the gateway via `SabclTransportService.call({ capability: … })`.

## Revoking a route

Set `"revoked": true` rather than deleting the definition:

```json
{
  "routeId": "identity.step-up",
  "service": "identity",
  "destination": "http://127.0.0.1:4101",
  "revoked": true
}
```

The route stops resolving immediately and returns `SABCL_ROUTE_INVALID` — the
same code and the same timing as an unknown token, so probing cannot distinguish
"revoked" from "never existed".

## Deliberately unreachable

These have no route and no capability, so no SABCL caller can reach them:

- `/internal/reconciliation`, `/internal/reconciliation/latest`
- `/internal/recovery/run`
- `/internal/journal-entries`
- `/api/v1/auth/onboarding/*`, `/api/v1/auth/fallback/*`, `/api/v1/auth/logout`
- `/api/v1/auth/passkeys/*`

Administrative surfaces stay on their existing operator paths. Browser-driven
authentication flows keep arriving through the gateway's authenticated,
CSRF-protected path — giving them a SABCL route would create a second way in.

`capabilities.test.ts` asserts each of these is unreachable from every
capability.

## Verifying

```bash
# Which routes are live, and are their services reachable?
curl -s http://127.0.0.1:4103/sabcl/v1/status | jq '{routes, reachability}'
```

Or open `/app/sabcl` in the web app, which proxies the same view through the
gateway so the router never needs to be reachable from a browser.

The status surface shows capability names and reachability. It never shows a
destination URL — that mapping is what the layer hides — and never a route token.

## Related

- [Protocol specification](./sabcl-protocol.md)
- [Key management and rotation](./sabcl-key-management.md)
- [Operations runbook](./sabcl-runbook.md)
