# AEGIS Shield Web

The customer-facing Next.js application shell for AEGIS Shield. Prompt 01 implements only the responsive platform foundation page; authentication and banking journeys are intentionally deferred.

Run commands from the repository root:

```powershell
pnpm --filter @aegis/web dev
pnpm --filter @aegis/web lint
pnpm --filter @aegis/web typecheck
pnpm --filter @aegis/web test
pnpm --filter @aegis/web build
```

The development server is available at `http://localhost:3000`.
