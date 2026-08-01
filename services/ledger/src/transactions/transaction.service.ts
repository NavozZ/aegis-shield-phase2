import {
  type CustomerTransactionDetail,
  type CustomerTransactionSummary,
  type TransactionHistoryQuery,
  type TransactionHistoryResponse,
} from '@aegis/contracts';
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  accountNotFoundError,
  LedgerError,
} from '../common/errors/ledger.error';
import { PrismaService } from '../database/prisma.service';
import { serializeMinorUnits } from '../money/money';

type PostingRow = {
  id: string;
  direction: 'DEBIT' | 'CREDIT';
  amountMinor: bigint;
  createdAt: Date;
  journalEntry: {
    entryType: 'ACCOUNT_ADJUSTMENT' | 'SETTLEMENT_FUNDING' | 'INTERNAL_TEST';
    effectiveAt: Date;
    createdAt: Date;
    status: 'POSTED';
  };
};

type Cursor = { v: 1; e: string; r: string; f: string };

function displayReference(id: string): string {
  const value = id.replaceAll('-', '').toUpperCase();
  return `AEGIS-TXN-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
}

function category(entryType: PostingRow['journalEntry']['entryType']) {
  return entryType === 'SETTLEMENT_FUNDING'
    ? 'FUNDING'
    : entryType === 'ACCOUNT_ADJUSTMENT'
      ? 'ADJUSTMENT'
      : 'OTHER';
}

function fingerprint(query: TransactionHistoryQuery): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        direction: query.direction,
        category: query.category,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      }),
    )
    .digest('base64url')
    .slice(0, 24);
}

function decodeCursor(
  value: string | undefined,
  expected: string,
): Cursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Cursor;
    if (
      parsed.v !== 1 ||
      parsed.f !== expected ||
      !/^AEGIS-TXN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/u.test(parsed.r) ||
      Number.isNaN(Date.parse(parsed.e))
    )
      throw new Error('Invalid cursor');
    return parsed;
  } catch {
    throw new LedgerError(
      'INVALID_REQUEST',
      'Invalid transaction history cursor.',
    );
  }
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

@Injectable()
export class TransactionService {
  constructor(private readonly prisma: PrismaService) {}

  private async account(customerId: string, accountId: string) {
    const account = await this.prisma.client.customerAccount.findFirst({
      where: { id: accountId, customerId },
      select: {
        id: true,
        ledgerAccountId: true,
        currency: true,
        maskedReference: true,
        productType: true,
      },
    });
    if (!account) throw accountNotFoundError();
    return account;
  }

  private async history(customerId: string, accountId: string) {
    const account = await this.account(customerId, accountId);
    // One ordered read over immutable postings establishes balance-after before
    // presentation filters are applied; no mutable transaction table exists.
    const postings = (await this.prisma.client.journalPosting.findMany({
      where: {
        ledgerAccountId: account.ledgerAccountId,
        journalEntry: { status: 'POSTED' },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        direction: true,
        amountMinor: true,
        createdAt: true,
        journalEntry: {
          select: {
            entryType: true,
            effectiveAt: true,
            createdAt: true,
            status: true,
          },
        },
      },
    })) as PostingRow[];
    let balance = 0n;
    const transactions: CustomerTransactionSummary[] = postings.map(
      (posting) => {
        balance +=
          posting.direction === 'CREDIT'
            ? posting.amountMinor
            : -posting.amountMinor;
        return {
          id: posting.id,
          displayReference: displayReference(posting.id),
          accountId,
          direction: posting.direction === 'CREDIT' ? 'INCOMING' : 'OUTGOING',
          category: category(posting.journalEntry.entryType),
          status: 'POSTED',
          amount: {
            currency: account.currency,
            minorUnits: serializeMinorUnits(posting.amountMinor),
          },
          balanceAfter: {
            currency: account.currency,
            minorUnits: serializeMinorUnits(balance),
          },
          effectiveAt: posting.journalEntry.effectiveAt.toISOString(),
          postedAt: posting.createdAt.toISOString(),
        };
      },
    );
    return { account, transactions };
  }

  async list(
    customerId: string,
    accountId: string,
    query: TransactionHistoryQuery,
  ): Promise<TransactionHistoryResponse> {
    const { transactions } = await this.history(customerId, accountId);
    const filter = fingerprint(query);
    const cursor = decodeCursor(query.cursor, filter);
    const from = query.dateFrom
      ? new Date(query.dateFrom).getTime()
      : undefined;
    const to = query.dateTo ? new Date(query.dateTo).getTime() : undefined;
    const filtered = transactions
      .filter((item) => !query.direction || item.direction === query.direction)
      .filter((item) => !query.category || item.category === query.category)
      .filter(
        (item) =>
          from === undefined || new Date(item.effectiveAt).getTime() >= from,
      )
      .filter(
        (item) =>
          to === undefined || new Date(item.effectiveAt).getTime() <= to,
      )
      .sort(
        (a, b) =>
          b.postedAt.localeCompare(a.postedAt) || b.id.localeCompare(a.id),
      );
    const start = cursor
      ? filtered.findIndex(
          (item) =>
            item.displayReference === cursor.r && item.postedAt === cursor.e,
        ) + 1
      : 0;
    if (cursor && start === 0)
      throw new LedgerError(
        'INVALID_REQUEST',
        'Invalid transaction history cursor.',
      );
    const page = filtered.slice(start, start + query.pageSize);
    const tail = page.at(-1);
    return {
      transactions: page,
      nextCursor:
        tail && start + page.length < filtered.length
          ? encodeCursor({
              v: 1,
              e: tail.postedAt,
              r: tail.displayReference,
              f: filter,
            })
          : null,
    };
  }

  async detail(
    customerId: string,
    accountId: string,
    transactionId: string,
  ): Promise<CustomerTransactionDetail> {
    const { account, transactions } = await this.history(customerId, accountId);
    const item = transactions.find(
      (transaction) => transaction.id === transactionId,
    );
    if (!item) throw accountNotFoundError();
    return {
      ...item,
      maskedAccountReference: account.maskedReference,
      productType: account.productType,
    };
  }
}
