# AEGIS Shield Web

The customer-facing Next.js application implements responsive English, Sinhala, and Tamil onboarding, passkey-first sign-in, protected routes, accounts, transaction history, secure transfer preview/PIN confirmation, sent/received lists, bounded processing polling, and printable records.

Financial responses are fetched with `no-store` and are never persisted in browser storage. The printable record hides navigation and controls, renders in black and white, and contains only customer-safe fields.

## Next.js version note

This application targets a Next.js major version with breaking changes to APIs,
conventions and file structure. Consult the bundled guides under
`node_modules/next/dist/docs/` for the version actually installed, and heed the
deprecation notices there, rather than relying on documentation for an earlier
release.

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

## Transfers

Transfer amounts stay decimal strings until shared-contract conversion to minor units. The form disables duplicate submission and reuses one in-memory idempotency key after an uncertain retry. Receiving references are shown only to their owner; previews and records use masked counterparties. `PROCESSING` records poll at a bounded interval, cancel on unmount, and warn after timeout. No financial value, PIN, intent, or idempotency key is written to `localStorage` or `sessionStorage`.
