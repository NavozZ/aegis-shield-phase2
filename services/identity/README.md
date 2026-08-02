# Identity service

`@aegis/identity-service` owns customer identity and authentication for AEGIS Shield. It is an internal NestJS service; browsers call the API Gateway, never this service directly.

## Runtime boundaries

- Loopback development address: `http://127.0.0.1:4101`
- PostgreSQL ownership: the `aegis_identity` database and `app` schema
- Redis ownership: keys below the configured `aegis:identity:*` prefix
- Browser CORS: disabled
- Internal calls: every non-public route requires `x-aegis-internal-token`

PostgreSQL stores users, Argon2id PIN credentials, public passkey credentials, counters, and masked authentication events. Redis stores hashed OTP challenges, resend/rate counters, enrollment tokens, passkey challenges, temporary lock state, and opaque sessions. Every Redis write has a bounded TTL except explicit session revocation, which deletes the key.

## Configuration

Copy the root `.env.example` to the ignored `.env` and configure:

- `IDENTITY_HOST`, `IDENTITY_PORT`, and `IDENTITY_SERVICE_URL`
- `IDENTITY_DATABASE_URL` with `?schema=app`
- `REDIS_URL` and `IDENTITY_REDIS_PREFIX`
- `IDENTITY_INTERNAL_TOKEN`
- `AUTH_SESSION_COOKIE_NAME`, `AUTH_CSRF_COOKIE_NAME`, and both session TTLs
- OTP TTL, resend cooldown, attempt limit, request limit, and `DEMO_AUTH_ENABLED`
- `WEBAUTHN_RP_NAME`, `WEBAUTHN_RP_ID`, and `WEBAUTHN_ORIGIN`
- `FIELD_ENCRYPTION_KEY` for future encrypted identity fields

Production startup rejects known local placeholders and demo OTP mode. Never print these values or commit `.env`.

## Database lifecycle

Run from the repository root:

```powershell
pnpm db:validate:identity
pnpm db:generate
pnpm db:migrate:identity
pnpm db:deploy:identity
```

Use `db:migrate:identity` only while deliberately developing a migration. Normal startup does not change the database. `pnpm dev:full` applies only committed migrations before starting workspaces.

## Endpoints

Health:

- `GET /health/live` checks the process and is public.
- `GET /health/ready` checks PostgreSQL and Redis and requires the internal token.

Tier-0 onboarding:

- `POST /api/v1/auth/onboarding/request-otp`
- `POST /api/v1/auth/onboarding/verify-otp`
- `POST /api/v1/auth/onboarding/create-pin`

PIN plus OTP fallback:

- `POST /api/v1/auth/fallback/request-otp`
- `POST /api/v1/auth/fallback/login`

Sessions:

- `GET /api/v1/auth/session`
- `POST /api/v1/auth/logout`

Passkeys:

- `POST /api/v1/auth/passkeys/registration/options`
- `POST /api/v1/auth/passkeys/registration/verify`
- `POST /api/v1/auth/passkeys/authentication/options`
- `POST /api/v1/auth/passkeys/authentication/verify`

The Gateway validates public contracts, forwards only this allowlist, and converts raw session/CSRF values into browser cookies. It never exposes Identity responses blindly.

## Testing

With local infrastructure running and migrations applied:

```powershell
pnpm --filter @aegis/identity-service test
pnpm --filter @aegis/identity-service test:e2e
pnpm auth:test:e2e
```

The final command starts the built Identity service as a separate process and tests the full public flow through the Gateway. Tests use synthetic example phone data, a unique Redis test prefix, and scoped cleanup guarded by `NODE_ENV=test`.

## Prototype limitations

Demo OTP exists only for local/test use and is intentionally rejected in production. No SMS provider, customer-facing authentication UI, account recovery, KYC upgrade, mTLS/workload identity, or real browser authenticator ceremony is included. The web application owns the browser UI and physical passkey ceremony.

## Transfer step-up

`POST /api/v1/auth/transfer-step-up` is internal-only. It validates the active session and six-digit PIN without extending the session, records success/failure evidence, and applies Redis-backed attempt cooldown. Gateway is the only transfer component that sends the PIN, and it sends it only to Identity; Payments and Ledger never receive or store it.
