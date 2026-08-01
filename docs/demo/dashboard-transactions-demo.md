# Dashboard and transaction history demo

Use synthetic data only. Start Docker with `pnpm infra:up`, verify it with
`pnpm infra:check`, apply migrations using `pnpm db:deploy`, and start the
stack with `pnpm stack:start`. Complete synthetic onboarding, create the
Tier-0 account, then use the trusted internal journal endpoint only in the
test harness to create funding and adjustment postings.

Reload the dashboard to see the masked account, balance, and recent activity.
Open account details to filter by direction, category, and date, page through
the immutable history, and open a safe transaction record. The print action
uses a black-and-white layout and contains no journal metadata. Switch between
English, Sinhala, and Tamil from the header, then log out. Stop the stack with
Ctrl+C and run `pnpm infra:down`; never use real customer or financial data.
