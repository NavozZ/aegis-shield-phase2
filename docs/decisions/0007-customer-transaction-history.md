# ADR 0007: Customer transaction history derives from postings

Customer history is a read model calculated from immutable `journal_postings`
joined to posted journal entries. A browser cannot create, alter, or delete a
transaction through this feature.

The Ledger applies customer ownership in the account lookup, calculates
liability balances as credits less debits in chronological posting order, and
returns only customer-safe fields. The Gateway derives customer identity from
the session and forwards it only as a trusted internal header.

History is ordered by posted time and transaction UUID, and uses an opaque,
filter-bound cursor. Amounts and balances remain decimal strings until display.

`balanceAfter` is calculated across the complete unfiltered posting chronology
before filters or pagination. `effectiveAt` is informational and cannot reorder
the append-only posting sequence. The tradeoff is an account-scoped posting read
until a future immutable projection is justified; the supporting composite index
bounds database access without introducing mutable transaction state.
