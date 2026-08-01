# AEGIS Shield API Gateway

The NestJS HTTP entry point for AEGIS Shield. It owns the public HTTP, cookie and CSRF boundary and forwards only allowlisted operations to private Identity, Payments, and Ledger services. It owns no credentials, user records, sessions or banking state, and it is not a generic proxy.

Customer transaction reads are `GET /api/v1/accounts/:accountId/transactions` and `GET /api/v1/accounts/:accountId/transactions/:transactionId`. The Gateway derives the customer from the session, validates queries and Ledger responses, forwards its trusted internal token and correlation ID server-side, and applies `Cache-Control: private, no-store`. No customer transaction-write route exists.

Run commands from the repository root:

```powershell
pnpm --filter @aegis/api-gateway dev
pnpm --filter @aegis/api-gateway lint
pnpm --filter @aegis/api-gateway typecheck
pnpm --filter @aegis/api-gateway test
pnpm --filter @aegis/api-gateway test:e2e
pnpm --filter @aegis/api-gateway test:e2e:accounts
pnpm --filter @aegis/api-gateway test:e2e:transfers
pnpm --filter @aegis/api-gateway build
```

The gateway defaults to `http://localhost:4000`. Override the port with `API_PORT`; invalid ports fail startup rather than silently selecting an unsafe value.

## Health contract

`GET http://localhost:4000/health` returns service identity, version, environment, and a dynamic ISO-8601 timestamp. It intentionally exposes no secrets or dependency details. This contract is unchanged.

`GET /health/ready` reports whether Identity, Ledger, and Payments are reachable.

Transfers are exposed under `/api/v1/transfers`. Reads require a session and use private no-store caching; preview and confirm additionally require CSRF. Confirmation requires a validated `Idempotency-Key`; Gateway sends the PIN only to Identity, then sends Payments only the intent, trusted session customer, and key. Completed responses are `200`; uncertain `PROCESSING` responses are `202`.

## Routes

Authentication (`/api/v1/auth/*`) is described in the [Identity README](../../services/identity/README.md).

Accounts:

| Method | Route                                 | Requirements                                                 |
| ------ | ------------------------------------- | ------------------------------------------------------------ |
| `GET`  | `/api/v1/accounts`                    | Authenticated session                                        |
| `POST` | `/api/v1/accounts/default`            | Authenticated session, CSRF header, `Idempotency-Key` header |
| `GET`  | `/api/v1/accounts/:accountId`         | Authenticated session, ownership                             |
| `GET`  | `/api/v1/accounts/:accountId/balance` | Authenticated session, ownership                             |

The acting customer is always derived from a session validated by the Identity service. A customer identifier supplied in a request body, query string or header is never used. An account belonging to another customer returns `404`, identical to one that does not exist.

There is deliberately no browser-facing route that posts a journal entry: ledger movements are a trusted service-to-service operation.

## Internal credentials

`IDENTITY_INTERNAL_TOKEN`, `LEDGER_INTERNAL_TOKEN`, and `PAYMENTS_INTERNAL_TOKEN` are server-side only. They are never echoed to a browser or exposed through a `NEXT_PUBLIC_` variable. Upstream responses are re-validated against shared contracts; malformed responses become a safe outage.
