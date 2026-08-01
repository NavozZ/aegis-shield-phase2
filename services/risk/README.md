# Risk service

`@aegis/risk-service` owns security events, deterministic assessments, incidents and scoped automated controls. It listens on loopback port `4105` in local development and owns the existing `aegis_audit` database. It never reads or writes Identity, Payments or Ledger databases.

## Trust boundaries

- Event ingestion uses a source-specific token; the claimed source must match that token. Events are strict version `1.0` objects with allowlisted attributes and a 32 KiB request limit.
- Internal assessment and control endpoints require `RISK_INTERNAL_TOKEN`. Callers provide facts, never a score or decision.
- Operator endpoints additionally require a short-lived opaque operator session. Browser mutations use double-submit CSRF; every mutation writes `operator_audits` and lifecycle history.
- `SESSION_REVOKE` calls Identity's trusted revocation endpoint. Risk never edits Identity state directly.
- Controls have a scope, reason, source, actor and expiry. Temporary automated controls cannot silently become permanent.

## State

PostgreSQL stores immutable original events and assessments plus incidents, controls and append-only histories. Redis stores hashed, namespaced, TTL-bounded velocity counters and operator sessions. No raw phone, PIN, OTP, session, cookie, token or full account reference belongs in either store.

## Commands

```text
pnpm db:deploy:risk
pnpm risk:test
pnpm risk:test:integration
pnpm risk:recover
pnpm risk:reconcile
```

Integration commands require PostgreSQL, authenticated Redis and the environment values documented in `.env.example`. `recover` expires stale controls and runs bounded retention. `reconcile` fails when links/history are orphaned, required high-risk incidents are missing, controls are improperly active after expiry, or sources are stale.

## Honest limitation

This is an explainable rule engine for deterministic enforcement and demonstrations. It is not a trained fraud model, does not infer protected characteristics, and does not replace human investigation. Thresholds require governance, observed false-positive measurement and controlled version changes before production use.
