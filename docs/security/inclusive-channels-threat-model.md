# Inclusive Channels Threat Model

This document outlines the security assumptions, identified threats, and mitigations for the Inclusive Payment Channels (QR Pay, USSD Banking, and Agent-assisted Cash Operations) implemented in AEGIS Phase 2.

## 1. System Boundaries & Actors

### Actors

- **Customer**: Initiates transactions via QR code, USSD menu, or provides cash to an Agent.
- **Agent**: An authorized representative handling physical cash deposits and withdrawals on behalf of AEGIS.
- **API Gateway**: Handles incoming webhook requests from external Telcos (USSD) and routing of authenticated requests.
- **Payments Service**: Orchestrates QR payload generation/verification, USSD session management, and Agent operation workflows.
- **Ledger Service**: The immutable source of truth for balances and transaction settlement.

### Trust Boundaries

- **QR Codes**: Encoded payloads displayed on untrusted devices (mobile phones, printed media).
- **USSD network**: The Telco network transmitting unencrypted USSD strings before reaching the AEGIS API Gateway.
- **Agent Devices**: Authorized but potentially compromised devices used by Agents to perform cash operations.

## 2. Identified Threats & Mitigations

### 2.1 QR Pay

| Threat                      | Description                                                                 | Mitigation                                                                                                                                                                                                |
| :-------------------------- | :-------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tampering (Spoofing QR)** | An attacker alters the payload to redirect funds to their account.          | All QR payloads are digitally signed using Ed25519 (HMAC/EdDSA). The Payments service verifies the signature upon redemption.                                                                             |
| **Replay Attacks**          | An attacker captures a valid QR code and scans it multiple times.           | Dynamic QRs include a cryptographic nonce. The `qrRedemption` idempotency key ensures each scan resolves to a single ledger transfer. Static QRs use idempotency keys based on the payer's unique intent. |
| **Expired QR Usage**        | Using an old QR code with favorable exchange rates or outdated constraints. | Payloads contain a strict `expiresAt` timestamp validated immediately upon payload decoding.                                                                                                              |

### 2.2 USSD Banking

| Threat                         | Description                                                     | Mitigation                                                                                                                                                                                |
| :----------------------------- | :-------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Session Hijacking/Spoofing** | An attacker intercepts or spoofs MSISDN from the Telco network. | Gateway MSISDN binding enforces strict correlation with the customer's identity. USSD sessions require a 6-digit Step-Up PIN validated via the Identity Service for sensitive operations. |
| **State Tampering**            | Manipulating USSD menus to bypass intent steps.                 | Server-side session state is securely managed in Redis. Client input only dictates the next state transition, not the core transaction parameters.                                        |
| **Telco Webhook Spoofing**     | Attacker calls `/ussd/webhook` mimicking the Telco.             | The API Gateway can restrict the `/ussd/webhook` endpoint via IP whitelisting, mTLS, or shared HMAC secrets (pending full Telco integration).                                             |

### 2.3 Agent Cash Operations

| Threat                               | Description                                                             | Mitigation                                                                                                                                                                       |
| :----------------------------------- | :---------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unauthorized Cash-In/Out**         | An attacker creates an operation on behalf of a victim.                 | Agent operations are two-step. The Agent _previews_ the operation (generating a short-lived `intentToken`), and the Customer _confirms_ it securely, transferring liability.     |
| **Double Spend / Double Settlement** | Agent or system glitch triggers multiple settlements for one operation. | The `agentCashOperation` table implements an `idempotencyKeyHash` combined with the `canonicalHash` of the request parameters. A single Ledger Journal is created per operation. |
| **Malicious Agent**                  | An Agent attempts to siphon funds via fake operations.                  | Agents operate under strict velocity and volume limits defined in `PAYMENTS_CONFIG`. Agents must have sufficient pre-funded balances (liability) for Cash-In operations.         |

## 3. Reconciliation & Recovery

The Payments Reconciliation Service runs asynchronously to verify the integrity of channel operations against the Ledger:

1. Validates that every `COMPLETED` QR Redemption has a corresponding `ledgerJournalId`.
2. Validates that every `COMPLETED` Agent Cash Operation has a corresponding `ledgerJournalId`.
3. Flags `PROCESSING` intents that have exceeded the TTL limit.

_Status: Implemented as part of P08-Channels release._
