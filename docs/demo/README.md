# Phase 2 Demonstration Plan

This directory will contain repeatable demonstration scripts and expected evidence. Each scenario must state prerequisites, synthetic test data, commands, expected observations, cleanup, and failure handling.

## Secure login

Implemented in Prompt 04. See [authentication-demo.md](authentication-demo.md) for
onboarding, OTP, Argon2id PIN, passkey registration and use, session lifecycle,
safe failure messages and the authentication audit trail.

## Accounts and ledger

Implemented in Prompt 05. See [accounts-ledger-demo.md](accounts-ledger-demo.md). Demonstrates idempotent Tier-0 account provisioning, a zero opening balance, ownership isolation, and a passing ledger reconciliation.

## Dashboard and transaction history

Implemented in Prompt 06. See [dashboard-transactions-demo.md](dashboard-transactions-demo.md).

## Protected transfer

Implemented in Prompt 07. See [customer-transfer-demo.md](customer-transfer-demo.md) for authorized idempotent settlement, replay, recovery, balanced Ledger evidence, responsive EN/SI/TA UI, and reconciliation.

## QR/offline payment

Implemented in Prompt 08. Walkthrough:
[../release/FINAL_DEMO_GUIDE.md](../release/FINAL_DEMO_GUIDE.md), inclusive-channel
journey. Signed QR payloads with dynamic and static expiry, replay rejection and
idempotent settlement; design and limits in
[../security/inclusive-channels-threat-model.md](../security/inclusive-channels-threat-model.md).

## USSD/agent access

Implemented in Prompt 08. Walkthrough:
[../release/FINAL_DEMO_GUIDE.md](../release/FINAL_DEMO_GUIDE.md), inclusive-channel
journey. Bounded USSD session state with expiry and webhook authentication, and
agent cash authorization with per-agent limits and idempotency; design and limits
in [../security/inclusive-channels-threat-model.md](../security/inclusive-channels-threat-model.md).

## Threat detection

Implemented in Prompt 10. See [risk-controls-demo.md](risk-controls-demo.md).

## Service quarantine

Implemented in Prompt 10. See [risk-controls-demo.md](risk-controls-demo.md) for a
synthetic integrity signal producing an expiring scoped control, enforced
independently at the Gateway, in Payments and in Identity, and released by an
operator with an audited reason. Failure behaviour is documented in
[../security/risk-failure-policy.md](../security/risk-failure-policy.md) and
[../operations/service-failure-runbook.md](../operations/service-failure-runbook.md).

## Recovery

Implemented in Prompt 11. See
[disaster-recovery-demo.md](disaster-recovery-demo.md). Demonstrates an encrypted
backup set, checksum-before-decrypt verification, the tamper, wrong-key,
incomplete and path-unsafe refusals against a real set, an isolated restore into
disposable databases, the full deterministic drill, the recovery operations
console, a controlled dependency failure and recovery, and the append-only
evidence trail refusing to be rewritten.

It is a prototype drill against local disposable infrastructure: no multi-region
disaster recovery, no continuous replication, no zero data loss, no compliance
certification, and no guaranteed recovery-point or recovery-time objective.

## SABCL traffic comparison

Implemented in Prompt 09. See [sabcl-routing-demo.md](sabcl-routing-demo.md).
Demonstrates strict-mode startup validation, the operator status page, a real
encrypted account read through the blind router, the privacy-safe audit trail,
the metadata leakage scan against seeded sensitive values, tampering and replay
rejection, the confused-deputy defence, and safe failure with no plaintext
fallback when the router is down.

The observable difference: before, `GET /internal/customers/{customerId}/accounts`
carried a customer identifier in a URL on the internal network. After, the router
sees a version, a random message identifier, an opaque route token, two key
identifiers, an ephemeral public key, timestamps, a nonce, a hop limit, a padding
bucket and ciphertext — and records only salted digests of the first two.
