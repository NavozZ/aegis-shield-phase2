# AEGIS Shield Web

The customer-facing Next.js application for AEGIS Shield. It implements responsive English, Sinhala, and Tamil onboarding, passkey-first sign-in, PIN/OTP fallback, protected session-aware routes, and a minimal authenticated account summary. Transfers, payments and transaction history remain deferred.

Run commands from the repository root:

```powershell
pnpm --filter @aegis/web dev
pnpm --filter @aegis/web lint
pnpm --filter @aegis/web typecheck
pnpm --filter @aegis/web test
pnpm --filter @aegis/web build
```

From the repository root, install Chromium and run the controlled browser suites:

```powershell
pnpm web:e2e:install
pnpm web:test:e2e
pnpm web:test:a11y
```

The browser sends authentication and account calls directly to `http://localhost:4000`; the Gateway remains the only public boundary. Authentication flow values stay in React memory. Only the selected interface language is persisted in browser storage, and the opaque session remains in an HttpOnly cookie.

## Account summary

The authenticated `/app` route renders a Tier-0 wallet summary from Gateway-validated data. When no account exists it offers a single **Create Tier-0 account** action that sends a generated `Idempotency-Key` and the CSRF header, and is disabled while the request is in flight so a double click cannot submit twice. A failed attempt reuses the same key on retry, so a retry can never create a second account.

Balances are received as minor-unit strings and formatted for display without converting through a JavaScript number, so a value beyond `Number.MAX_SAFE_INTEGER` still renders exactly. A new account displays `LKR 0.00`. The interface shows no fabricated funds, transactions or interest, and never renders a raw customer identifier, a full account reference, or an internal ledger identifier.

The development server is available at `http://localhost:3000`.
