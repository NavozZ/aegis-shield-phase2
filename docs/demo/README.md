# Phase 2 Demonstration Plan

This directory will contain repeatable demonstration scripts and expected evidence. Each scenario must state prerequisites, synthetic test data, commands, expected observations, cleanup, and failure handling.

## Secure login

To be completed during implementation. Demonstrate customer authentication, token lifecycle, authorization, safe failure messages, and relevant audit evidence.

## Accounts and ledger

Implemented in Prompt 05. See [accounts-ledger-demo.md](accounts-ledger-demo.md). Demonstrates idempotent Tier-0 account provisioning, a zero opening balance, ownership isolation, and a passing ledger reconciliation.

## Dashboard and transaction history

Implemented in Prompt 06. See [dashboard-transactions-demo.md](dashboard-transactions-demo.md).

## Protected transfer

Implemented in Prompt 07. See [customer-transfer-demo.md](customer-transfer-demo.md) for authorized idempotent settlement, replay, recovery, balanced Ledger evidence, responsive EN/SI/TA UI, and reconciliation.

## QR/offline payment

To be completed during implementation. Demonstrate QR initiation and the designed low-connectivity or offline-assisted workflow, including reconciliation and duplicate protection.

## USSD/agent access

To be completed during implementation. Demonstrate inclusive access controls, session protection, agent authorization, and safe handling of constrained-channel data.

## Threat detection

Implemented in Prompt 10. See [risk-controls-demo.md](risk-controls-demo.md).

## Service quarantine

To be completed during implementation. Demonstrate isolation of a simulated compromised service while preserving explicit safety and recovery boundaries.

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
