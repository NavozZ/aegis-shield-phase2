import {
  MAX_RECONCILIATION_ISSUES,
  reconciliationResultSchema,
  type ReconciliationIssue,
  type ReconciliationResult,
} from '@aegis/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

interface IssueRow {
  identifier: string | null;
}

interface CountRow {
  total: bigint;
}

/**
 * Reconciliation recomputes every invariant from the immutable postings rather
 * than trusting the balance projections. It is read-only apart from recording
 * its own run, and reports only non-customer identifiers: journal references,
 * ledger account codes and masked account references.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger('LedgerReconciliation');

  constructor(private readonly prisma: PrismaService) {}

  async run(correlationId: string): Promise<ReconciliationResult> {
    const startedAt = new Date();
    const issues: ReconciliationIssue[] = [];
    const client = this.prisma.client;

    const add = (
      code: string,
      severity: 'WARNING' | 'ERROR',
      rows: IssueRow[],
    ): void => {
      for (const row of rows) {
        if (issues.length >= MAX_RECONCILIATION_ISSUES) return;
        issues.push({
          code,
          severity,
          ...(row.identifier
            ? { safeIdentifier: row.identifier.slice(0, 64) }
            : {}),
        });
      }
    };

    const [
      journalCount,
      postingCount,
      ledgerAccountCount,
      customerAccountCount,
    ] = await Promise.all([
      client.journalEntry.count(),
      client.journalPosting.count(),
      client.ledgerAccount.count(),
      client.customerAccount.count(),
    ]);

    // Every journal must balance and hold at least two postings.
    add(
      'UNBALANCED_JOURNAL',
      'ERROR',
      await client.$queryRaw<IssueRow[]>`
        SELECT entry."reference" AS identifier
        FROM "app"."journal_entries" AS entry
        LEFT JOIN "app"."journal_postings" AS posting
          ON posting."journal_entry_id" = entry."id"
        GROUP BY entry."id", entry."reference"
        HAVING COUNT(posting."id") < 2
           OR COALESCE(SUM(CASE WHEN posting."direction" = 'DEBIT' THEN posting."amount_minor" ELSE 0 END), 0)
            <> COALESCE(SUM(CASE WHEN posting."direction" = 'CREDIT' THEN posting."amount_minor" ELSE 0 END), 0)
        LIMIT ${MAX_RECONCILIATION_ISSUES}
      `,
    );

    // Posting currency must match both its journal and its ledger account.
    add(
      'POSTING_CURRENCY_MISMATCH',
      'ERROR',
      await client.$queryRaw<IssueRow[]>`
        SELECT entry."reference" AS identifier
        FROM "app"."journal_postings" AS posting
        JOIN "app"."journal_entries" AS entry ON entry."id" = posting."journal_entry_id"
        JOIN "app"."ledger_accounts" AS account ON account."id" = posting."ledger_account_id"
        WHERE posting."currency" <> entry."currency"
           OR posting."currency" <> account."currency"
        LIMIT ${MAX_RECONCILIATION_ISSUES}
      `,
    );

    add(
      'NON_POSITIVE_POSTING_AMOUNT',
      'ERROR',
      await client.$queryRaw<IssueRow[]>`
        SELECT entry."reference" AS identifier
        FROM "app"."journal_postings" AS posting
        JOIN "app"."journal_entries" AS entry ON entry."id" = posting."journal_entry_id"
        WHERE posting."amount_minor" <= 0
        LIMIT ${MAX_RECONCILIATION_ISSUES}
      `,
    );

    // The projection is only a cache: it must equal the recomputed totals.
    add(
      'BALANCE_PROJECTION_DRIFT',
      'ERROR',
      await client.$queryRaw<IssueRow[]>`
        SELECT account."code" AS identifier
        FROM "app"."ledger_accounts" AS account
        JOIN "app"."balance_projections" AS projection
          ON projection."ledger_account_id" = account."id"
        LEFT JOIN (
          SELECT
            "ledger_account_id",
            COALESCE(SUM(CASE WHEN "direction" = 'DEBIT' THEN "amount_minor" ELSE 0 END), 0) AS debit_total,
            COALESCE(SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount_minor" ELSE 0 END), 0) AS credit_total
          FROM "app"."journal_postings"
          GROUP BY "ledger_account_id"
        ) AS actual ON actual."ledger_account_id" = account."id"
        WHERE projection."debit_total_minor" <> COALESCE(actual.debit_total, 0)
           OR projection."credit_total_minor" <> COALESCE(actual.credit_total, 0)
        LIMIT ${MAX_RECONCILIATION_ISSUES}
      `,
    );

    add(
      'MISSING_BALANCE_PROJECTION',
      'ERROR',
      await client.$queryRaw<IssueRow[]>`
        SELECT account."code" AS identifier
        FROM "app"."ledger_accounts" AS account
        LEFT JOIN "app"."balance_projections" AS projection
          ON projection."ledger_account_id" = account."id"
        WHERE projection."ledger_account_id" IS NULL
        LIMIT ${MAX_RECONCILIATION_ISSUES}
      `,
    );

    // A customer account must be backed by a liability account in its currency.
    add(
      'CUSTOMER_ACCOUNT_LEDGER_MISMATCH',
      'ERROR',
      await client.$queryRaw<IssueRow[]>`
        SELECT customer_account."masked_reference" AS identifier
        FROM "app"."customer_accounts" AS customer_account
        LEFT JOIN "app"."ledger_accounts" AS account
          ON account."id" = customer_account."ledger_account_id"
        WHERE account."id" IS NULL
           OR account."account_class" <> 'LIABILITY'
           OR account."currency" <> customer_account."currency"
        LIMIT ${MAX_RECONCILIATION_ISSUES}
      `,
    );

    add(
      'DUPLICATE_DEFAULT_ACCOUNT',
      'ERROR',
      await client.$queryRaw<IssueRow[]>`
        SELECT MIN(customer_account."masked_reference") AS identifier
        FROM "app"."customer_accounts" AS customer_account
        GROUP BY customer_account."customer_id", customer_account."product_type", customer_account."currency"
        HAVING COUNT(*) > 1
        LIMIT ${MAX_RECONCILIATION_ISSUES}
      `,
    );

    // Customer wallets are liabilities: credits minus debits may not go below zero.
    add(
      'NEGATIVE_CUSTOMER_BALANCE',
      'ERROR',
      await client.$queryRaw<IssueRow[]>`
        SELECT customer_account."masked_reference" AS identifier
        FROM "app"."customer_accounts" AS customer_account
        JOIN "app"."ledger_accounts" AS account
          ON account."id" = customer_account."ledger_account_id"
        JOIN "app"."balance_projections" AS projection
          ON projection."ledger_account_id" = account."id"
        WHERE (projection."credit_total_minor" - projection."debit_total_minor") < 0
        LIMIT ${MAX_RECONCILIATION_ISSUES}
      `,
    );

    const [systemAccounts] = await client.$queryRaw<CountRow[]>`
      SELECT COUNT(DISTINCT "system_account_type") AS total
      FROM "app"."ledger_accounts"
      WHERE "system_account_type" IS NOT NULL
    `;
    if (Number(systemAccounts?.total ?? 0) < 2) {
      add('MISSING_SYSTEM_ACCOUNT', 'ERROR', [{ identifier: null }]);
    }

    const completedAt = new Date();
    const status = issues.some((issue) => issue.severity === 'ERROR')
      ? 'FAIL'
      : 'PASS';

    const stored = await client.reconciliationRun.create({
      data: {
        status,
        startedAt,
        completedAt,
        checkedJournalEntries: journalCount,
        checkedPostings: postingCount,
        checkedLedgerAccounts: ledgerAccountCount,
        checkedCustomerAccounts: customerAccountCount,
        issueCount: issues.length,
        issues,
        correlationId,
      },
      select: { id: true },
    });

    this.logger.log(
      JSON.stringify({
        event: 'reconciliation_completed',
        correlationId,
        status,
        issueCount: issues.length,
      }),
    );

    return reconciliationResultSchema.parse({
      id: stored.id,
      status,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      checkedJournalEntries: journalCount,
      checkedPostings: postingCount,
      checkedLedgerAccounts: ledgerAccountCount,
      checkedCustomerAccounts: customerAccountCount,
      issueCount: issues.length,
      issues,
    });
  }

  async latest(): Promise<ReconciliationResult | null> {
    const run = await this.prisma.client.reconciliationRun.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    if (!run) return null;
    return reconciliationResultSchema.parse({
      id: run.id,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt.toISOString(),
      checkedJournalEntries: run.checkedJournalEntries,
      checkedPostings: run.checkedPostings,
      checkedLedgerAccounts: run.checkedLedgerAccounts,
      checkedCustomerAccounts: run.checkedCustomerAccounts,
      issueCount: run.issueCount,
      issues: run.issues,
    });
  }
}
