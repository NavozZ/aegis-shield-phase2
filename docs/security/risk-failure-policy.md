# Risk failure policy

| Operation                               | Risk unavailable         | Reason                                                                                |
| --------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------- |
| Transfer confirmation at Gateway        | Fail closed (503)        | A sensitive debit must not bypass controls.                                           |
| Final transfer processing at Payments   | Fail closed (503)        | Payments independently protects the final posting boundary.                           |
| Operator read/mutation                  | Fail closed              | Authorization and audit cannot be skipped.                                            |
| Authentication event telemetry          | Fail open                | Identity persists its local audit; Risk outage must not lock out every customer.      |
| Gateway/Payments/Ledger event telemetry | Fail open                | The primary result remains authoritative; source health exposes the gap.              |
| Non-sensitive account/history read      | No synchronous Risk call | Availability and least coupling; active controls are checked on sensitive operations. |

Timeouts are bounded and public errors are generic. Internal reason codes remain in Risk for operators. A single subject's control is never converted into a global outage.
