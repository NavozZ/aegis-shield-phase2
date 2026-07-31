# AEGIS Shield API Gateway

The NestJS HTTP entry point for AEGIS Shield. Prompt 01 exposes only `GET /health`; authentication, banking routes, data stores, and service transports are intentionally deferred.

Run commands from the repository root:

```powershell
pnpm --filter @aegis/api-gateway dev
pnpm --filter @aegis/api-gateway lint
pnpm --filter @aegis/api-gateway typecheck
pnpm --filter @aegis/api-gateway test
pnpm --filter @aegis/api-gateway test:e2e
pnpm --filter @aegis/api-gateway build
```

The gateway defaults to `http://localhost:4000`. Override the port with `API_PORT`; invalid ports fail startup rather than silently selecting an unsafe value.

## Health contract

`GET http://localhost:4000/health` returns service identity, version, environment, and a dynamic ISO-8601 timestamp. It intentionally exposes no secrets or dependency details.
