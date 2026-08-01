# Customer transfer threat model

## Assets and trust boundaries

Assets are session authority, PINs, intent tokens, idempotency keys, customer ownership, balances, immutable journals, lifecycle evidence, and safe public transfer records. Trust boundaries are Browser → Gateway, Gateway → Identity/Payments, Payments → Ledger, and each service → its own PostgreSQL schema.

## Threats and controls

| Threat                              | Control                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Browser claims another customer     | Gateway ignores/rejects browser `customerId` and derives it from the validated session                   |
| Cross-site submission               | SameSite cookies plus timing-safe double-submit CSRF check                                               |
| Stolen session initiates transfer   | Fresh PIN step-up; PIN travels only to Identity; attempt cooldown and rate limiting                      |
| Intent theft or database disclosure | 256-bit opaque token, short expiry, customer binding, SHA-256 hash at rest, atomic one-time consumption  |
| Duplicate click/retry               | Stable browser idempotency key, customer-scoped hashed key, canonical request conflict check             |
| Double spend/race                   | Daily-limit transaction lock plus Ledger row locks and balance check inside one transaction              |
| Deadlock                            | Ledger locks source and recipient accounts in deterministic UUID order                                   |
| Lost Ledger response                | `PROCESSING`, same deterministic Ledger command key, bounded recovery, `REQUIRES_REVIEW`                 |
| Ledger tampering                    | Balanced journal constraint, immutable journal/posting triggers, reconciliation                          |
| Ownership probing                   | Foreign account/transfer reads use the same `404` response as absent records                             |
| Sensitive response/log data         | Masked references, allowlisted schemas, no PIN/token/hash/internal identifiers, private no-store caching |
| Client precision loss               | Decimal string validation and integer minor-unit `bigint` arithmetic                                     |

## Residual risk

This prototype does not connect to external payment rails, production OTP delivery, hardware-backed workload identity, fraud scoring, or a human case-management system. `REQUIRES_REVIEW` is therefore an evidence-preserving terminal queue state, not an automated accounting decision. Use synthetic data only.
