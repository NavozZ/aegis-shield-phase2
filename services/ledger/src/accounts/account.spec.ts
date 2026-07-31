import type { PrismaService } from '../database/prisma.service';
import type { IdempotencyService } from '../idempotency/idempotency.service';
import { AccountService } from './account.service';

const customerId = '11111111-1111-4111-8111-111111111111';
const otherCustomerId = '99999999-9999-4999-8999-999999999999';
const accountId = '22222222-2222-4222-8222-222222222222';
const ledgerAccountId = '33333333-3333-4333-8333-333333333333';

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: accountId,
    maskedReference: 'AEGIS-****-****-8T3W',
    productType: 'TIER0_WALLET',
    status: 'ACTIVE',
    currency: 'LKR',
    createdAt: new Date('2026-07-31T10:00:00.000Z'),
    ledgerAccount: {
      accountClass: 'LIABILITY',
      balanceProjection: {
        debitTotalMinor: 0n,
        creditTotalMinor: 0n,
        updatedAt: new Date('2026-07-31T10:00:00.000Z'),
      },
    },
    ...overrides,
  };
}

function buildService(options: {
  findFirst?: jest.Mock;
  findMany?: jest.Mock;
  existingInTransaction?: unknown;
}) {
  const txCustomerCreate = jest.fn(() => Promise.resolve(accountRow()));
  const ledgerAccountCreates: Array<Record<string, unknown>> = [];
  const txLedgerCreate = jest.fn((args: { data: Record<string, unknown> }) => {
    ledgerAccountCreates.push(args.data);
    return Promise.resolve({ id: ledgerAccountId });
  });
  const executeRaw = jest.fn(() => Promise.resolve(1));

  const tx = {
    $executeRaw: executeRaw,
    customerAccount: {
      findUnique: jest.fn((args: { where: Record<string, unknown> }) =>
        Promise.resolve(
          'publicReference' in args.where
            ? null
            : (options.existingInTransaction ?? null),
        ),
      ),
      create: txCustomerCreate,
    },
    ledgerAccount: { create: txLedgerCreate },
  };

  const idempotency = {
    execute: jest.fn(
      async (opts: { run: (tx: unknown) => Promise<unknown> }) => ({
        result: await opts.run(tx),
        replayed: false,
      }),
    ),
  } as unknown as IdempotencyService;

  const prisma = {
    client: {
      customerAccount: {
        findFirst: options.findFirst ?? jest.fn(() => Promise.resolve(null)),
        findMany: options.findMany ?? jest.fn(() => Promise.resolve([])),
      },
    },
  } as unknown as PrismaService;

  return {
    service: new AccountService(prisma, idempotency),
    tx,
    txCustomerCreate,
    txLedgerCreate,
    ledgerAccountCreates,
    executeRaw,
    idempotency,
    prisma,
  };
}

describe('AccountService provisioning', () => {
  const input = {
    customerId,
    productType: 'TIER0_WALLET' as const,
    currency: 'LKR',
    idempotencyKey: 'provision-account-0123456789',
  };

  it('creates a zero-balance liability wallet for a new customer', async () => {
    const { service, ledgerAccountCreates } = buildService({});
    const result = await service.provisionDefault(input);

    expect(result.created).toBe(true);
    expect(result.account.balance).toEqual({
      currency: 'LKR',
      minorUnits: '0',
    });
    expect(result.account.status).toBe('ACTIVE');
    expect(ledgerAccountCreates).toHaveLength(1);
    expect(ledgerAccountCreates[0]).toMatchObject({
      accountClass: 'LIABILITY',
      normalBalance: 'CREDIT',
      allowNegativeBalance: false,
      currency: 'LKR',
    });
  });

  it('writes no journal entry and invents no opening funds', async () => {
    const { service, tx } = buildService({});
    await service.provisionDefault(input);
    expect(tx).not.toHaveProperty('journalEntry');
    expect(tx).not.toHaveProperty('journalPosting');
  });

  it('serialises provisioning with an advisory lock before reading', async () => {
    const { service, executeRaw } = buildService({});
    await service.provisionDefault(input);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('returns the existing account instead of creating a duplicate', async () => {
    const { service, txCustomerCreate } = buildService({
      existingInTransaction: accountRow(),
    });
    const result = await service.provisionDefault(input);

    expect(result.created).toBe(false);
    expect(result.account.id).toBe(accountId);
    expect(txCustomerCreate).not.toHaveBeenCalled();
  });

  it('never exposes the internal ledger account identifier', async () => {
    const { service } = buildService({});
    const result = await service.provisionDefault(input);
    expect(JSON.stringify(result)).not.toContain(ledgerAccountId);
  });

  it('never exposes the raw customer identifier in the account payload', async () => {
    const { service } = buildService({});
    const result = await service.provisionDefault(input);
    expect(JSON.stringify(result)).not.toContain(customerId);
  });
});

describe('AccountService ownership enforcement', () => {
  it('lists only the requesting customer accounts', async () => {
    const findMany = jest.fn(() => Promise.resolve([accountRow()]));
    const { service } = buildService({ findMany });

    const result = await service.listForCustomer(customerId);

    expect(result.accounts).toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId } }),
    );
  });

  it('scopes account detail lookups by customer', async () => {
    const findFirst = jest.fn(() => Promise.resolve(accountRow()));
    const { service } = buildService({ findFirst });

    await service.getForCustomer(customerId, accountId);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: accountId, customerId } }),
    );
  });

  it('conceals another customer account behind a generic not-found error', async () => {
    const findFirst = jest.fn(() => Promise.resolve(null));
    const { service } = buildService({ findFirst });

    await expect(
      service.getForCustomer(otherCustomerId, accountId),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND', status: 404 });
  });

  it('conceals another customer balance behind the same error', async () => {
    const findFirst = jest.fn(() => Promise.resolve(null));
    const { service } = buildService({ findFirst });

    await expect(
      service.getBalanceForCustomer(otherCustomerId, accountId),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND', status: 404 });
  });

  it('reports a liability balance as credits minus debits', async () => {
    const findFirst = jest.fn(() =>
      Promise.resolve(
        accountRow({
          ledgerAccount: {
            accountClass: 'LIABILITY',
            balanceProjection: {
              debitTotalMinor: 2_000n,
              creditTotalMinor: 12_500n,
              updatedAt: new Date('2026-07-31T11:00:00.000Z'),
            },
          },
        }),
      ),
    );
    const { service } = buildService({ findFirst });

    const balance = await service.getBalanceForCustomer(customerId, accountId);

    expect(balance.balance).toEqual({ currency: 'LKR', minorUnits: '10500' });
    expect(typeof balance.balance.minorUnits).toBe('string');
  });

  it('reports a brand-new account as exactly zero', async () => {
    const findFirst = jest.fn(() => Promise.resolve(accountRow()));
    const { service } = buildService({ findFirst });

    const balance = await service.getBalanceForCustomer(customerId, accountId);

    expect(balance.balance.minorUnits).toBe('0');
  });
});
