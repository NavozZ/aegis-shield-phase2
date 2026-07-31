import {
  journalResultSchema,
  type InternalJournalRequest,
  type JournalResult,
  type LedgerAccountClass,
  type PostingDirection,
} from '@aegis/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  LEDGER_CONFIG,
  type LedgerConfig,
} from '../common/config/ledger.config';
import {
  accountNotFoundError,
  currencyMismatchError,
  insufficientFundsError,
  unbalancedJournalError,
} from '../common/errors/ledger.error';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import {
  IDEMPOTENCY_SCOPES,
  IdempotencyService,
} from '../idempotency/idempotency.service';
import {
  applyDirection,
  parseMinorUnits,
  serializeMinorUnits,
  signedBalanceMinor,
} from '../money/money';

export interface JournalActor {
  type: 'SERVICE' | 'CUSTOMER' | 'SYSTEM';
  id: string;
}

interface LockedAccount {
  id: string;
  currency: string;
  accountClass: LedgerAccountClass;
  allowNegativeBalance: boolean;
  debitTotalMinor: bigint;
  creditTotalMinor: bigint;
  version: number;
}

/**
 * Combines repeated postings to the same account and direction so that a
 * journal cannot contain two rows competing for the same sequence, while
 * preserving the caller's ordering for the surviving rows.
 */
export function normalisePostings(
  postings: InternalJournalRequest['postings'],
): Array<{
  ledgerAccountId: string;
  direction: PostingDirection;
  amountMinor: bigint;
}> {
  const combined = new Map<
    string,
    {
      ledgerAccountId: string;
      direction: PostingDirection;
      amountMinor: bigint;
    }
  >();
  for (const posting of postings) {
    const key = `${posting.ledgerAccountId}:${posting.direction}`;
    const amountMinor = parseMinorUnits(posting.amountMinor);
    const existing = combined.get(key);
    if (existing) {
      existing.amountMinor += amountMinor;
      continue;
    }
    combined.set(key, {
      ledgerAccountId: posting.ledgerAccountId,
      direction: posting.direction,
      amountMinor,
    });
  }
  return [...combined.values()];
}

export function assertBalanced(
  postings: ReadonlyArray<{
    direction: PostingDirection;
    amountMinor: bigint;
  }>,
): bigint {
  if (postings.length < 2) throw unbalancedJournalError();
  let debitTotal = 0n;
  let creditTotal = 0n;
  for (const posting of postings) {
    if (posting.amountMinor <= 0n) throw unbalancedJournalError();
    if (posting.direction === 'DEBIT') debitTotal += posting.amountMinor;
    else creditTotal += posting.amountMinor;
  }
  if (debitTotal !== creditTotal || debitTotal === 0n) {
    throw unbalancedJournalError();
  }
  return debitTotal;
}

@Injectable()
export class JournalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    @Inject(LEDGER_CONFIG) private readonly config: LedgerConfig,
  ) {}

  /**
   * Posts a balanced journal atomically.
   *
   * The application validates the entry before opening a transaction, locks
   * every affected account in a deterministic order, then writes the entry, its
   * postings and the balance projections in one transaction. Deferred database
   * constraint triggers re-check the balance rule at COMMIT.
   */
  async post(
    request: InternalJournalRequest,
    correlationId: string,
    actor: JournalActor,
  ): Promise<JournalResult> {
    const postings = normalisePostings(request.postings);
    const totalMinor = assertBalanced(postings);

    const outcome = await this.idempotency.execute<JournalResult>({
      scope: IDEMPOTENCY_SCOPES.journalEntry,
      idempotencyKey: request.idempotencyKey,
      payload: {
        entryType: request.entryType,
        currency: request.currency,
        reference: request.reference,
        description: request.description,
        effectiveAt: request.effectiveAt,
        metadata: request.metadata,
        postings: postings
          .map((posting) => ({
            ledgerAccountId: posting.ledgerAccountId,
            direction: posting.direction,
            amountMinor: serializeMinorUnits(posting.amountMinor),
          }))
          .sort((left, right) =>
            `${left.ledgerAccountId}:${left.direction}` <
            `${right.ledgerAccountId}:${right.direction}`
              ? -1
              : 1,
          ),
      },
      encode: (value) => value as unknown as Prisma.InputJsonValue,
      decode: (value) => journalResultSchema.parse(value),
      run: async (tx) => {
        const accounts = await this.lockAccounts(
          tx,
          postings.map((posting) => posting.ledgerAccountId),
        );
        this.assertPostableAccounts(accounts, request.currency);

        const projected = new Map<string, LockedAccount>(
          accounts.map((account) => [account.id, { ...account }]),
        );
        for (const posting of postings) {
          const account = projected.get(posting.ledgerAccountId);
          if (!account) throw accountNotFoundError();
          const totals = applyDirection(
            posting.direction,
            posting.amountMinor,
            {
              debitTotalMinor: account.debitTotalMinor,
              creditTotalMinor: account.creditTotalMinor,
            },
          );
          account.debitTotalMinor = totals.debitTotalMinor;
          account.creditTotalMinor = totals.creditTotalMinor;
        }

        for (const account of projected.values()) {
          const balance = signedBalanceMinor(
            account.accountClass,
            account.debitTotalMinor,
            account.creditTotalMinor,
          );
          if (balance < 0n && !account.allowNegativeBalance) {
            throw insufficientFundsError();
          }
        }

        const effectiveAt = request.effectiveAt
          ? new Date(request.effectiveAt)
          : new Date();
        const entry = await tx.journalEntry.create({
          data: {
            reference: request.reference ?? `JRN-${randomUUID()}`,
            entryType: request.entryType,
            status: 'POSTED',
            currency: request.currency,
            description: request.description,
            correlationId,
            effectiveAt,
            createdByType: actor.type,
            createdById: actor.id.slice(0, 64),
            metadata: (request.metadata ?? {}) as Prisma.InputJsonValue,
          },
          select: { id: true, reference: true, createdAt: true },
        });

        const createdPostings: JournalResult['postings'] = [];
        for (const [sequence, posting] of postings.entries()) {
          const created = await tx.journalPosting.create({
            data: {
              journalEntryId: entry.id,
              ledgerAccountId: posting.ledgerAccountId,
              direction: posting.direction,
              amountMinor: posting.amountMinor,
              currency: request.currency,
              sequence,
            },
            select: { id: true },
          });
          createdPostings.push({
            id: created.id,
            ledgerAccountId: posting.ledgerAccountId,
            direction: posting.direction,
            amountMinor: serializeMinorUnits(posting.amountMinor),
            sequence,
          });
        }

        for (const account of projected.values()) {
          await tx.balanceProjection.update({
            where: { ledgerAccountId: account.id },
            data: {
              debitTotalMinor: account.debitTotalMinor,
              creditTotalMinor: account.creditTotalMinor,
              version: { increment: 1 },
            },
          });
        }

        return {
          id: entry.id,
          reference: entry.reference,
          entryType: request.entryType,
          currency: request.currency,
          totalMinor: serializeMinorUnits(totalMinor),
          effectiveAt: effectiveAt.toISOString(),
          createdAt: entry.createdAt.toISOString(),
          postings: createdPostings,
        };
      },
    });
    return outcome.result;
  }

  /**
   * Locks accounts and their projections in ascending identifier order. A fixed
   * order across every caller is what prevents two concurrent journals from
   * deadlocking on the same pair of accounts.
   */
  private async lockAccounts(
    tx: Prisma.TransactionClient,
    ledgerAccountIds: readonly string[],
  ): Promise<LockedAccount[]> {
    const uniqueIds = [...new Set(ledgerAccountIds)].sort();
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        currency: string;
        account_class: LedgerAccountClass;
        allow_negative_balance: boolean;
        debit_total_minor: bigint;
        credit_total_minor: bigint;
        version: number;
      }>
    >`
      SELECT
        account."id",
        account."currency",
        account."account_class",
        account."allow_negative_balance",
        projection."debit_total_minor",
        projection."credit_total_minor",
        projection."version"
      FROM "app"."ledger_accounts" AS account
      JOIN "app"."balance_projections" AS projection
        ON projection."ledger_account_id" = account."id"
      WHERE account."id" = ANY(${uniqueIds}::uuid[])
      ORDER BY account."id"
      FOR UPDATE OF account, projection
    `;

    if (rows.length !== uniqueIds.length) throw accountNotFoundError();
    return rows.map((row) => ({
      id: row.id,
      currency: row.currency,
      accountClass: row.account_class,
      allowNegativeBalance: row.allow_negative_balance,
      debitTotalMinor: BigInt(row.debit_total_minor),
      creditTotalMinor: BigInt(row.credit_total_minor),
      version: Number(row.version),
    }));
  }

  private assertPostableAccounts(
    accounts: readonly LockedAccount[],
    currency: string,
  ): void {
    for (const account of accounts) {
      if (account.currency !== currency) throw currencyMismatchError();
    }
  }

  /** Exposed for diagnostics and reconciliation tooling. */
  get maxRetries(): number {
    return this.config.maxPostingRetries;
  }
}
