# @aegis/sabcl

The SABCL/1 protocol: encrypted service envelopes, metadata-minimising routing,
replay protection and service key rotation.

Framework-agnostic. The NestJS wiring lives in the services that use it.

## Modules

| Path                          | Contents                                                     |
| ----------------------------- | ------------------------------------------------------------ |
| `protocol/version.ts`         | Wire constants and domain-separation tags                    |
| `protocol/envelope.ts`        | Envelope schemas — **the privacy boundary**                  |
| `protocol/canonical.ts`       | Length-prefixed encoding for signed material                 |
| `protocol/seal.ts`            | `sealRequest`, `openRequest`, `sealResponse`, `openResponse` |
| `protocol/padding.ts`         | Bucketed padding                                             |
| `protocol/route-token.ts`     | HMAC-derived tokens and the allowlist table                  |
| `protocol/payload.ts`         | Inner request/response contracts                             |
| `protocol/errors.ts`          | Coarse, safe failure taxonomy                                |
| `crypto/primitives.ts`        | X25519, HKDF-SHA-256, AES-256-GCM, Ed25519                   |
| `crypto/keyring.ts`           | Identities, rotation, revocation                             |
| `catalog/capabilities.ts`     | Shared capability and path allowlist catalogue               |
| `client/sabcl-client.ts`      | Sender side                                                  |
| `server/sabcl-recipient.ts`   | Recipient side                                               |
| `server/loopback-dispatch.ts` | Dispatch onto the service's own HTTP surface                 |
| `server/recipient-runtime.ts` | Environment → working recipient                              |
| `replay/`                     | Replay-store interface, in-memory and Redis implementations  |
| `audit/audit.ts`              | Privacy-safe operational events                              |
| `config/environment.ts`       | Mode resolution and startup validation                       |
| `testing/`                    | Deterministic non-production fixtures                        |

## Usage

**Sending:**

```ts
const client = new SabclClient({ keyring, routerUrl, routeSecret, timeoutMs });
const response = await client.send({
  routeId: 'ledger.accounts',
  service: 'ledger',
  request: {
    op: 'ledger.accounts.get',
    method: 'GET',
    path: `/internal/customers/${customerId}/accounts`,
    actor: { customerId }, // encrypted; never routing metadata
    correlationId,
  },
});
```

**Receiving:**

```ts
const runtime = createSabclRecipientRuntime({
  service: 'ledger',
  environmentPrefix: 'SABCL_LEDGER',
  selfUrl,
  internalToken,
  nodeEnvironment,
  redisUrl,
  redisPrefix,
  dispatchTimeoutMs: 5_000,
});
const outcome = await runtime.handle(envelope); // never throws
```

## Key generation

```bash
pnpm --filter @aegis/sabcl keys:generate -- --service gateway --version 1
pnpm --filter @aegis/sabcl keys:generate -- --route-secret
```

## Test fixtures

`testing/fixtures.ts` provides deterministic identities so a failure is
reproducible. That determinism is exactly why the material is worthless outside a
test — anyone reading the file can regenerate every private key in it.

`loadSabclEnvironment` refuses fixture material in `strict` mode. The check
cannot be a pattern match, because the fixture keys are raw base64url of a hash
and look exactly like real random bytes; it recomputes the fixture for the
configured key identifier and compares.

## Tests

```bash
pnpm sabcl:test           # 116 tests
pnpm sabcl:test:leakage   # metadata leakage and capability allowlist
```

## Documentation

[Protocol specification](../../docs/security/sabcl-protocol.md) ·
[ADR 0009](../../docs/decisions/0009-sabcl-privacy-and-secure-routing.md) ·
[Threat model](../../docs/security/sabcl-threat-model.md) ·
[Metadata leakage](../../docs/security/sabcl-metadata-leakage.md) ·
[Replay and expiry](../../docs/security/sabcl-replay-and-expiry.md)
