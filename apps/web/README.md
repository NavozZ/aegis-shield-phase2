# AEGIS Shield Web

The customer-facing Next.js application for AEGIS Shield. It implements responsive English, Sinhala, and Tamil onboarding, passkey-first sign-in, PIN/OTP fallback, protected session-aware routes, and an intentionally empty authenticated workspace. Banking journeys remain deferred.

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

The browser sends authentication calls directly to `http://localhost:4000`; the Gateway remains the only public authentication boundary. Authentication flow values stay in React memory. Only the selected interface language is persisted in browser storage, and the opaque session remains in an HttpOnly cookie.

The development server is available at `http://localhost:3000`.
