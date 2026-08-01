# Customer transfer demonstration

## Prerequisites

Use synthetic identities only. Copy `.env.example` to ignored `.env`, keep `DEMO_AUTH_ENABLED=true`, then run `pnpm dev:full`. Open `http://localhost:3000` in two separate browser contexts.

## Scenario

1. Onboard sender and recipient with distinct synthetic phones and create one Tier-0 account each.
2. Add synthetic test funding to the sender through the internal Ledger test setup; never use real funds.
3. Copy the recipient's receiving reference. On the sender, choose **Send money**, enter that reference and an exact LKR decimal amount, and preview.
4. Verify only masked source/recipient references appear. Enter a wrong PIN once and observe the generic safe error; then use the sender's synthetic PIN.
5. Observe the printable `COMPLETED` record, reduced sender balance, increased recipient balance, sender `OUTGOING / TRANSFER`, recipient `INCOMING / TRANSFER`, and SENT/RECEIVED transfer lists.
6. Repeat the same confirmation request/key and observe the same transfer ID with no second journal.
7. Demonstrate self-transfer, insufficient funds, and expired-intent failures. An induced Ledger outage yields `PROCESSING`; `pnpm payments:recover` converges it after Ledger returns.
8. Switch EN/SI/TA, inspect 320 px/768 px/1440 px layouts, log out, and confirm `/app/transfers` redirects to sign-in.

## Evidence and cleanup

Run `pnpm payments:test:e2e`, `pnpm web:test:e2e`, `pnpm web:test:a11y`, `pnpm ledger:reconcile`, and `pnpm payments:reconcile`. Browser harnesses isolate phone/Redis state, remove only their synthetic Identity/account mappings, preserve immutable posted evidence, stop services, and run `pnpm infra:down`.
