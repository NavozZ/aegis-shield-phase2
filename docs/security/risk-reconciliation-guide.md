# Risk reconciliation and recovery

Run `pnpm risk:recover` after interrupted processing, then `pnpm risk:reconcile`. Recovery safely expires overdue controls and applies bounded retention. Reconciliation checks automated control links, orphan control/incident events, missing incidents for high/critical assessments and stale sources. It never changes Ledger balances.

A failure requires operator investigation. Compare source health with source-local audit, replay using the original stable source event ID, rerun assessment only with its original evaluation ID when recovering an interrupted call, and repeat reconciliation. Do not fabricate a decision or delete lifecycle history to make the check pass.
