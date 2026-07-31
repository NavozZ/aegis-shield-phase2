import type { InternalJournalRequest } from '@aegis/contracts';
import type { LedgerConfig } from '../common/config/ledger.config';
import { LedgerError } from '../common/errors/ledger.error';
import type { PrismaService } from '../database/prisma.service';
import type { IdempotencyService } from '../idempotency/idempotency.service';
import {
  assertBalanced,
  JournalService,
  normalisePostings,
} from './journal.service';

const customerWallet = '11111111-1111-4111-8111-111111111111';
const settlementAsset = '22222222-2222-4222-8222-222222222222';
const otherWallet = '33333333-3333-4333-8333-333333333333';
const correlationId = '44444444-4444-4444-8444-444444444444';

interface FakeAccount {
  id: string;
  currency: string;
  account_class: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  allow_negative_balance: boolean;
  debit_total_minor: bigint;
  credit_total_minor: bigint;
  version: number;
}

function fakeAccount(overrides: Partial<FakeAccount> = {}): FakeAccount {
  return {
    id: customerWallet,
    currency: 'LKR',
    account_class: 'LIABILITY',
    allow_negative_balance: false,
    debit_total_minor: 0n,
    credit_total_minor: 0n,
    version: 0,
    ...overrides,
  };
}

/**
 * Builds a JournalService whose idempotency layer runs the work inline, so the
 * accounting rules can be exercised without a database.
 */
function buildService(accounts: FakeAccount[]) {
  const lockedIdOrder: string[][] = [];
  const projectionUpdates: Array<{
    ledgerAccountId: string;
    debitTotalMinor: bigint;
    creditTotalMinor: bigint;
  }> = [];
  const createdPostings: Array<{ sequence: number; amountMinor: bigint }> = [];

  const tx = {
    $queryRaw: jest.fn((_strings: TemplateStringsArray, ids: string[]) => {
      lockedIdOrder.push([...ids]);
      const matched = accounts.filter((account) => ids.includes(account.id));
      return Promise.resolve(
        [...matched].sort((left, right) => left.id.localeCompare(right.id)),
      );
    }),
    journalEntry: {
      create: jest.fn(() =>
        Promise.resolve({
          id: '55555555-5555-4555-8555-555555555555',
          reference: 'JRN-TEST-REFERENCE',
          createdAt: new Date('2026-07-31T10:00:00.000Z'),
        }),
      ),
    },
    journalPosting: {
      create: jest.fn(
        (args: { data: { sequence: number; amountMinor: bigint } }) => {
          createdPostings.push({
            sequence: args.data.sequence,
            amountMinor: args.data.amountMinor,
          });
          return Promise.resolve({
            id: `66666666-6666-4666-8666-66666666666${createdPostings.length}`,
          });
        },
      ),
    },
    balanceProjection: {
      update: jest.fn(
        (args: {
          where: { ledgerAccountId: string };
          data: { debitTotalMinor: bigint; creditTotalMinor: bigint };
        }) => {
          projectionUpdates.push({
            ledgerAccountId: args.where.ledgerAccountId,
            debitTotalMinor: args.data.debitTotalMinor,
            creditTotalMinor: args.data.creditTotalMinor,
          });
          return Promise.resolve({});
        },
      ),
    },
  };

  const idempotency = {
    execute: jest.fn(
      async (options: { run: (tx: unknown) => Promise<unknown> }) => ({
        result: await options.run(tx),
        replayed: false,
      }),
    ),
  } as unknown as IdempotencyService;

  const service = new JournalService({} as PrismaService, idempotency, {
    maxPostingRetries: 3,
  } as LedgerConfig);

  return { service, tx, lockedIdOrder, projectionUpdates, createdPostings };
}

function request(
  overrides: Partial<InternalJournalRequest> = {},
): InternalJournalRequest {
  return {
    entryType: 'INTERNAL_TEST',
    currency: 'LKR',
    idempotencyKey: 'journal-test-key-0123456789',
    postings: [
      {
        ledgerAccountId: settlementAsset,
        direction: 'DEBIT',
        amountMinor: '500',
      },
      {
        ledgerAccountId: customerWallet,
        direction: 'CREDIT',
        amountMinor: '500',
      },
    ],
    ...overrides,
  } as InternalJournalRequest;
}

describe('double-entry validation', () => {
  it('accepts a balanced journal', () => {
    expect(
      assertBalanced([
        { direction: 'DEBIT', amountMinor: 500n },
        { direction: 'CREDIT', amountMinor: 500n },
      ]),
    ).toBe(500n);
  });

  it('accepts a balanced journal with several postings per side', () => {
    expect(
      assertBalanced([
        { direction: 'DEBIT', amountMinor: 300n },
        { direction: 'DEBIT', amountMinor: 200n },
        { direction: 'CREDIT', amountMinor: 500n },
      ]),
    ).toBe(500n);
  });

  it('rejects an unbalanced journal', () => {
    expect(() =>
      assertBalanced([
        { direction: 'DEBIT', amountMinor: 500n },
        { direction: 'CREDIT', amountMinor: 400n },
      ]),
    ).toThrow(LedgerError);
  });

  it('rejects a journal with a single posting', () => {
    expect(() =>
      assertBalanced([{ direction: 'DEBIT', amountMinor: 500n }]),
    ).toThrow(LedgerError);
  });

  it('rejects a zero-amount posting', () => {
    expect(() =>
      assertBalanced([
        { direction: 'DEBIT', amountMinor: 0n },
        { direction: 'CREDIT', amountMinor: 0n },
      ]),
    ).toThrow(LedgerError);
  });

  it('rejects a negative posting amount', () => {
    expect(() =>
      assertBalanced([
        { direction: 'DEBIT', amountMinor: -500n },
        { direction: 'CREDIT', amountMinor: -500n },
      ]),
    ).toThrow(LedgerError);
  });
});

describe('posting normalisation', () => {
  it('combines repeated postings to the same account and direction', () => {
    const normalised = normalisePostings([
      {
        ledgerAccountId: customerWallet,
        direction: 'CREDIT',
        amountMinor: '300',
      },
      {
        ledgerAccountId: customerWallet,
        direction: 'CREDIT',
        amountMinor: '200',
      },
      {
        ledgerAccountId: settlementAsset,
        direction: 'DEBIT',
        amountMinor: '500',
      },
    ]);
    expect(normalised).toHaveLength(2);
    expect(normalised[0]).toEqual({
      ledgerAccountId: customerWallet,
      direction: 'CREDIT',
      amountMinor: 500n,
    });
  });

  it('keeps opposite directions on the same account separate', () => {
    const normalised = normalisePostings([
      {
        ledgerAccountId: customerWallet,
        direction: 'CREDIT',
        amountMinor: '300',
      },
      {
        ledgerAccountId: customerWallet,
        direction: 'DEBIT',
        amountMinor: '100',
      },
    ]);
    expect(normalised).toHaveLength(2);
  });
});

describe('JournalService.post', () => {
  it('posts a balanced journal and updates both projections', async () => {
    const { service, projectionUpdates, createdPostings } = buildService([
      fakeAccount({ id: customerWallet }),
      fakeAccount({
        id: settlementAsset,
        account_class: 'ASSET',
        allow_negative_balance: true,
      }),
    ]);

    const result = await service.post(request(), correlationId, {
      type: 'SERVICE',
      id: 'test',
    });

    expect(result.totalMinor).toBe('500');
    expect(result.postings).toHaveLength(2);
    expect(projectionUpdates).toHaveLength(2);
    expect(
      projectionUpdates.find((u) => u.ledgerAccountId === customerWallet),
    ).toEqual({
      ledgerAccountId: customerWallet,
      debitTotalMinor: 0n,
      creditTotalMinor: 500n,
    });
    expect(createdPostings.map((posting) => posting.sequence)).toEqual([0, 1]);
  });

  it('locks every affected account in ascending identifier order', async () => {
    const { service, lockedIdOrder } = buildService([
      fakeAccount({ id: customerWallet }),
      fakeAccount({
        id: settlementAsset,
        account_class: 'ASSET',
        allow_negative_balance: true,
      }),
    ]);

    // Postings are supplied in descending order on purpose.
    await service.post(
      request({
        postings: [
          {
            ledgerAccountId: settlementAsset,
            direction: 'DEBIT',
            amountMinor: '500',
          },
          {
            ledgerAccountId: customerWallet,
            direction: 'CREDIT',
            amountMinor: '500',
          },
        ],
      }),
      correlationId,
      { type: 'SERVICE', id: 'test' },
    );

    expect(lockedIdOrder[0]).toEqual([customerWallet, settlementAsset]);
    expect(lockedIdOrder[0]).toEqual([...lockedIdOrder[0]!].sort());
  });

  it('rejects a posting whose account uses a different currency', async () => {
    const { service } = buildService([
      fakeAccount({ id: customerWallet, currency: 'USD' }),
      fakeAccount({
        id: settlementAsset,
        account_class: 'ASSET',
        allow_negative_balance: true,
      }),
    ]);

    await expect(
      service.post(request(), correlationId, { type: 'SERVICE', id: 'test' }),
    ).rejects.toMatchObject({ code: 'CURRENCY_MISMATCH' });
  });

  it('rejects a debit that would overdraw a customer wallet', async () => {
    const { service } = buildService([
      fakeAccount({ id: customerWallet, credit_total_minor: 100n }),
      fakeAccount({
        id: settlementAsset,
        account_class: 'ASSET',
        allow_negative_balance: true,
      }),
    ]);

    await expect(
      service.post(
        request({
          postings: [
            {
              ledgerAccountId: customerWallet,
              direction: 'DEBIT',
              amountMinor: '500',
            },
            {
              ledgerAccountId: settlementAsset,
              direction: 'CREDIT',
              amountMinor: '500',
            },
          ],
        }),
        correlationId,
        { type: 'SERVICE', id: 'test' },
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
  });

  it('permits a debit exactly equal to the available balance', async () => {
    const { service } = buildService([
      fakeAccount({ id: customerWallet, credit_total_minor: 500n }),
      fakeAccount({
        id: settlementAsset,
        account_class: 'ASSET',
        allow_negative_balance: true,
      }),
    ]);

    await expect(
      service.post(
        request({
          postings: [
            {
              ledgerAccountId: customerWallet,
              direction: 'DEBIT',
              amountMinor: '500',
            },
            {
              ledgerAccountId: settlementAsset,
              direction: 'CREDIT',
              amountMinor: '500',
            },
          ],
        }),
        correlationId,
        { type: 'SERVICE', id: 'test' },
      ),
    ).resolves.toMatchObject({ totalMinor: '500' });
  });

  it('allows a configured system account to go negative', async () => {
    const { service } = buildService([
      fakeAccount({ id: customerWallet }),
      fakeAccount({
        id: settlementAsset,
        account_class: 'ASSET',
        allow_negative_balance: true,
      }),
    ]);

    // The settlement asset is credited with no prior debits, taking it negative.
    await expect(
      service.post(request(), correlationId, { type: 'SERVICE', id: 'test' }),
    ).resolves.toMatchObject({ totalMinor: '500' });
  });

  it('rejects a journal that references an unknown account', async () => {
    const { service } = buildService([fakeAccount({ id: customerWallet })]);

    await expect(
      service.post(
        request({
          postings: [
            {
              ledgerAccountId: otherWallet,
              direction: 'DEBIT',
              amountMinor: '500',
            },
            {
              ledgerAccountId: customerWallet,
              direction: 'CREDIT',
              amountMinor: '500',
            },
          ],
        }),
        correlationId,
        { type: 'SERVICE', id: 'test' },
      ),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });

  it('rejects an unbalanced request before opening a transaction', async () => {
    const { service, tx } = buildService([fakeAccount({ id: customerWallet })]);

    await expect(
      service.post(
        request({
          postings: [
            {
              ledgerAccountId: settlementAsset,
              direction: 'DEBIT',
              amountMinor: '500',
            },
            {
              ledgerAccountId: customerWallet,
              direction: 'CREDIT',
              amountMinor: '400',
            },
          ],
        }),
        correlationId,
        { type: 'SERVICE', id: 'test' },
      ),
    ).rejects.toMatchObject({ code: 'UNBALANCED_JOURNAL' });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
