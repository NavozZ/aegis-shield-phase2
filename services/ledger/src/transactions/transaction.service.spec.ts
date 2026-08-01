import { TransactionService } from './transaction.service';
import type { PrismaService } from '../database/prisma.service';

const customerId = '11111111-1111-4111-8111-111111111111';
const otherCustomerId = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';
const ledgerAccountId = '44444444-4444-4444-8444-444444444444';

function posting(
  id: string,
  direction: 'CREDIT' | 'DEBIT',
  amountMinor: bigint,
  entryType:
    | 'SETTLEMENT_FUNDING'
    | 'ACCOUNT_ADJUSTMENT'
    | 'INTERNAL_TEST'
    | 'CUSTOMER_TRANSFER',
  postedAt: string,
  effectiveAt = postedAt,
) {
  return {
    id,
    direction,
    amountMinor,
    createdAt: new Date(postedAt),
    journalEntry: {
      entryType,
      effectiveAt: new Date(effectiveAt),
      createdAt: new Date(postedAt),
      status: 'POSTED' as const,
      reference: 'INTERNAL-SECRET',
      metadata: { secret: true },
      correlationId: customerId,
      createdById: 'system',
    },
  };
}

function build(postings: ReturnType<typeof posting>[], owned = true) {
  const findFirst = jest.fn(({ where }: { where: { customerId: string } }) =>
    Promise.resolve(
      owned && where.customerId === customerId
        ? {
            id: accountId,
            ledgerAccountId,
            currency: 'LKR',
            maskedReference: 'AEGIS-****-****-8T3W',
            productType: 'TIER0_WALLET' as const,
          }
        : null,
    ),
  );
  const findMany = jest.fn(() => Promise.resolve(postings));
  const prisma = {
    client: {
      customerAccount: { findFirst },
      journalPosting: { findMany },
    },
  } as unknown as PrismaService;
  return { service: new TransactionService(prisma), findFirst, findMany };
}

const query = { pageSize: 20 };

describe('TransactionService customer-safe history', () => {
  it('maps liability directions and entry categories', async () => {
    const rows = [
      posting(
        '00000000-0000-4000-8000-000000000001',
        'CREDIT',
        100n,
        'SETTLEMENT_FUNDING',
        '2026-08-01T10:00:00.000Z',
      ),
      posting(
        '00000000-0000-4000-8000-000000000002',
        'DEBIT',
        20n,
        'ACCOUNT_ADJUSTMENT',
        '2026-08-01T10:01:00.000Z',
      ),
      posting(
        '00000000-0000-4000-8000-000000000003',
        'CREDIT',
        5n,
        'INTERNAL_TEST',
        '2026-08-01T10:02:00.000Z',
      ),
    ];
    const result = await build(rows).service.list(customerId, accountId, query);
    expect(
      result.transactions.map(({ direction, category }) => ({
        direction,
        category,
      })),
    ).toEqual([
      { direction: 'INCOMING', category: 'OTHER' },
      { direction: 'OUTGOING', category: 'ADJUSTMENT' },
      { direction: 'INCOMING', category: 'FUNDING' },
    ]);
  });

  it('maps both sides of a customer transfer without exposing journal metadata', async () => {
    const rows = [
      posting(
        '00000000-0000-4000-8000-000000000001',
        'DEBIT',
        125n,
        'CUSTOMER_TRANSFER',
        '2026-08-01T10:01:00.000Z',
      ),
      posting(
        '00000000-0000-4000-8000-000000000002',
        'CREDIT',
        125n,
        'CUSTOMER_TRANSFER',
        '2026-08-01T10:02:00.000Z',
      ),
    ];
    const result = await build(rows).service.list(customerId, accountId, query);
    expect(
      result.transactions.map(({ direction, category }) => ({
        direction,
        category,
      })),
    ).toEqual([
      { direction: 'INCOMING', category: 'TRANSFER' },
      { direction: 'OUTGOING', category: 'TRANSFER' },
    ]);
    expect(JSON.stringify(result)).not.toContain('metadata');
    expect(JSON.stringify(result)).not.toContain('INTERNAL-SECRET');
  });

  it('calculates exact historical balances before presentation ordering', async () => {
    const huge = 9_007_199_254_740_993n;
    const rows = [
      posting(
        '00000000-0000-4000-8000-000000000001',
        'CREDIT',
        huge,
        'SETTLEMENT_FUNDING',
        '2026-08-01T10:00:00.000Z',
      ),
      posting(
        '00000000-0000-4000-8000-000000000002',
        'DEBIT',
        3n,
        'ACCOUNT_ADJUSTMENT',
        '2026-08-01T10:01:00.000Z',
      ),
    ];
    const result = await build(rows).service.list(customerId, accountId, query);
    expect(result.transactions[0]?.amount.minorUnits).toBe('3');
    expect(result.transactions[0]?.balanceAfter.minorUnits).toBe(
      '9007199254740990',
    );
    expect(result.transactions[1]?.balanceAfter.minorUnits).toBe(
      '9007199254740993',
    );
  });

  it('uses postedAt then UUID, not effectiveAt, for display ordering', async () => {
    const rows = [
      posting(
        '00000000-0000-4000-8000-000000000001',
        'CREDIT',
        1n,
        'INTERNAL_TEST',
        '2026-08-01T10:00:00.000Z',
        '2026-08-03T00:00:00.000Z',
      ),
      posting(
        '00000000-0000-4000-8000-000000000002',
        'CREDIT',
        1n,
        'INTERNAL_TEST',
        '2026-08-01T10:00:00.000Z',
        '2026-08-01T00:00:00.000Z',
      ),
    ];
    const result = await build(rows).service.list(customerId, accountId, query);
    expect(result.transactions.map((item) => item.id)).toEqual([
      rows[1]?.id,
      rows[0]?.id,
    ]);
  });

  it('returns a deterministic safe reference and excludes internal fields', async () => {
    const row = posting(
      'abcdef01-2345-4789-8abc-def012345678',
      'CREDIT',
      7n,
      'INTERNAL_TEST',
      '2026-08-01T10:00:00.000Z',
    );
    const result = await build([row]).service.list(
      customerId,
      accountId,
      query,
    );
    expect(result.transactions[0]?.displayReference).toBe(
      'AEGIS-TXN-ABCD-EF01-2345',
    );
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      'INTERNAL-SECRET',
      'metadata',
      'createdBy',
      'correlationId',
      ledgerAccountId,
    ])
      expect(serialized).not.toContain(forbidden);
  });

  it('paginates without duplicates and binds cursors to filters', async () => {
    const rows = [1, 2, 3].map((value) =>
      posting(
        `00000000-0000-4000-8000-00000000000${value}`,
        'CREDIT',
        BigInt(value),
        'SETTLEMENT_FUNDING',
        `2026-08-01T10:0${value}:00.000Z`,
      ),
    );
    const service = build(rows).service;
    const first = await service.list(customerId, accountId, { pageSize: 2 });
    expect(first.transactions).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = await service.list(customerId, accountId, {
      pageSize: 2,
      cursor: first.nextCursor!,
    });
    expect(second.transactions).toHaveLength(1);
    expect(
      new Set(
        [...first.transactions, ...second.transactions].map((item) => item.id),
      ).size,
    ).toBe(3);
    await expect(
      service.list(customerId, accountId, {
        pageSize: 2,
        direction: 'OUTGOING',
        cursor: first.nextCursor!,
      }),
    ).rejects.toThrow('Invalid transaction history cursor');
  });

  it('rejects malformed and unsupported cursors', async () => {
    const service = build([]).service;
    await expect(
      service.list(customerId, accountId, { pageSize: 20, cursor: 'not-json' }),
    ).rejects.toThrow('Invalid transaction history cursor');
    const unsupported = Buffer.from(
      JSON.stringify({
        v: 2,
        e: new Date().toISOString(),
        r: 'AEGIS-TXN-0000-0000-0000',
        f: 'x',
      }),
    ).toString('base64url');
    await expect(
      service.list(customerId, accountId, {
        pageSize: 20,
        cursor: unsupported,
      }),
    ).rejects.toThrow('Invalid transaction history cursor');
  });

  it('filters without changing authoritative balanceAfter', async () => {
    const rows = [
      posting(
        '00000000-0000-4000-8000-000000000001',
        'CREDIT',
        100n,
        'SETTLEMENT_FUNDING',
        '2026-08-01T10:00:00.000Z',
      ),
      posting(
        '00000000-0000-4000-8000-000000000002',
        'DEBIT',
        25n,
        'ACCOUNT_ADJUSTMENT',
        '2026-08-01T10:01:00.000Z',
      ),
    ];
    const result = await build(rows).service.list(customerId, accountId, {
      pageSize: 20,
      direction: 'OUTGOING',
      category: 'ADJUSTMENT',
    });
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]?.balanceAfter.minorUnits).toBe('75');
  });

  it('enforces account ownership in the database predicate', async () => {
    const { service, findFirst, findMany } = build([], false);
    await expect(
      service.list(otherCustomerId, accountId, query),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND', status: 404 });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: accountId, customerId: otherCustomerId },
      }),
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it('conceals nonexistent and wrong-account transactions', async () => {
    const row = posting(
      '00000000-0000-4000-8000-000000000001',
      'CREDIT',
      1n,
      'INTERNAL_TEST',
      '2026-08-01T10:00:00.000Z',
    );
    const service = build([row]).service;
    await expect(
      service.detail(
        customerId,
        accountId,
        '00000000-0000-4000-8000-000000000099',
      ),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND', status: 404 });
  });

  it('returns a safe owned transaction detail', async () => {
    const row = posting(
      '00000000-0000-4000-8000-000000000001',
      'CREDIT',
      1n,
      'SETTLEMENT_FUNDING',
      '2026-08-01T10:00:00.000Z',
    );
    const result = await build([row]).service.detail(
      customerId,
      accountId,
      row.id,
    );
    expect(result).toMatchObject({
      maskedAccountReference: 'AEGIS-****-****-8T3W',
      productType: 'TIER0_WALLET',
      direction: 'INCOMING',
      category: 'FUNDING',
    });
  });
});
