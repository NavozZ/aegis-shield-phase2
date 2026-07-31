# Local data and messaging infrastructure

Prompt 02 provides reproducible local PostgreSQL and Redis services through Docker Compose. The services are development dependencies only: no application connects to either container yet.

## Architecture overview

Docker Compose runs exactly two independent services on the dedicated `aegis-network` bridge network:

| Service    | Official image          | Local endpoint   | Purpose                                                                    |
| ---------- | ----------------------- | ---------------- | -------------------------------------------------------------------------- |
| PostgreSQL | `postgres:17.10-alpine` | `127.0.0.1:5432` | Prototype service-owned relational databases                               |
| Redis      | `redis:8.6.5-alpine`    | `127.0.0.1:6379` | Future sessions, idempotency records, cache, and lightweight event streams |

Both host ports are configurable through `.env`, but remain bound to loopback. PostgreSQL stores data in the named `aegis-postgres-data` volume. Redis enables append-only persistence in `aegis-redis-data`. `pnpm infra:down` preserves both volumes.

## Prototype database isolation

One local PostgreSQL container hosts four databases to keep the development footprint small:

| Database         | Owning login role |
| ---------------- | ----------------- |
| `aegis_identity` | `aegis_identity`  |
| `aegis_ledger`   | `aegis_ledger`    |
| `aegis_payments` | `aegis_payments`  |
| `aegis_audit`    | `aegis_audit`     |

Each login owns only its matching database and its `app` schema. Service roles cannot create roles or databases, replicate, bypass row-level security, or inherit other role permissions. Default public database connections are revoked. The local administrative role retains maintenance access.

This is logical isolation for a prototype. Production deployments should use stronger isolation, separate managed instances or clusters where appropriate, network policy, workload identity, rotation, backup controls, and monitored least-privilege access.

## Environment setup

Copy the tracked template to an ignored local file:

```powershell
Copy-Item .env.example .env
```

Change every value ending in `_PASSWORD` in `.env` before startup. The tracked values are obvious local-development placeholders, not production credentials. Database URLs must be updated whenever their matching credentials or ports change.

Compose also has matching local-only defaults so CI and first-run validation do not require a committed environment file. Never commit `.env`.

## Commands

Validate files, declarations, and the resolved Compose model:

```powershell
pnpm infra:validate
docker compose config
docker compose config --quiet
```

Start the services, wait for Docker health checks, and verify databases, roles, ownership, and authenticated Redis access:

```powershell
pnpm infra:up
pnpm infra:check
```

Inspect status and the latest 200 log lines:

```powershell
pnpm infra:status
pnpm infra:logs
pnpm infra:logs -- postgres
pnpm infra:logs -- redis
```

Start infrastructure first and then the existing web/API development processes:

```powershell
pnpm dev:full
```

Press `Ctrl+C` to stop the frontend and backend processes. Infrastructure intentionally remains active until it is stopped explicitly:

```powershell
pnpm infra:down
```

## Destructive reset

Reset removes only the two Compose-managed local data volumes, recreates the services, waits for health, and runs the full check. It refuses to delete a volume whose Docker ownership labels do not match this Compose project. The explicit confirmation is mandatory:

```powershell
pnpm infra:reset -- --yes
```

Do not use reset when local prototype data must be retained.

## Initialization behavior

`infra/docker/postgres/init/01-create-service-databases.sh` runs only when PostgreSQL initializes an empty `aegis-postgres-data` volume. Editing the script or changing database environment variables does not retrofit an existing volume. Use the confirmed reset command when a deliberate clean reinitialization is required.

The script uses Unix LF line endings, strict error handling, validated identifiers, PostgreSQL-safe quoting, and password variables that are never printed. It creates roles, databases, and schemas only; it creates no application tables or seed users.

## Troubleshooting

### Docker Desktop on Windows

Start Docker Desktop and wait until the Linux container engine is running. Confirm `docker info` and `docker compose version` work from PowerShell. WSL 2 integration may need to be enabled after a Docker Desktop or Windows update.

### Port conflicts

Do not kill an unknown process. Identify the listener, then change `POSTGRES_PORT` or `REDIS_PORT` in `.env`. Keep the binding on `127.0.0.1`. Update the corresponding database or Redis URLs.

### A service is unhealthy

```powershell
pnpm infra:status
pnpm infra:logs -- postgres
pnpm infra:logs -- redis
```

Initialization SQL errors appear in the PostgreSQL logs. Authentication failures generally indicate that `.env` URLs and password variables do not match the credentials used when the volume was first initialized.

### Credentials changed after first startup

PostgreSQL initialization variables apply only to a new volume. Either restore the original local credentials or intentionally run the destructive reset after confirming the stored prototype data is disposable.

## Local security limitations

Loopback bindings, authenticated Redis, least-privilege prototype roles, and untracked credentials reduce accidental exposure; they do not make this a production deployment. Compose environment values are visible to local users with Docker access, local traffic is not TLS-encrypted, the admin account uses a development password, and all services share one Docker host and bridge network. Use synthetic data only.
