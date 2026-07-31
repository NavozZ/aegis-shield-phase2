import type { LedgerConfig } from '../common/config/ledger.config';
import type { PrismaService } from '../database/prisma.service';
import {
  IDEMPOTENCY_SCOPES,
  IdempotencyService,
  isIdempotencyConflict,
} from './idempotency.service';
import { canonicalRequestHash } from '../common/security/security';

const payload = { customerId: 'abc', productType: 'TIER0_WALLET' };
const storedResponse = { account: { id: 'account-1' }, created: true };

class UniqueViolation extends Error {
  readonly code = 'P2002';
  constructor(readonly meta: { target: string[] }) {
    super('Unique constraint failed');
  }
}

function buildService(options: {
  findUnique: jest.Mock;
  transaction?: jest.Mock;
}) {
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const create = jest.fn((args: { data: Record<string, unknown> }) => {
    created.push(args.data);
    return Promise.resolve({});
  });
  const update = jest.fn((args: { data: Record<string, unknown> }) => {
    updated.push(args.data);
    return Promise.resolve({});
  });
  const transaction =
    options.transaction ??
    jest.fn((work: (tx: unknown) => Promise<unknown>) =>
      work({ idempotencyRecord: { create, update } }),
    );

  const prisma = {
    client: {
      $transaction: transaction,
      idempotencyRecord: { findUnique: options.findUnique },
    },
  } as unknown as PrismaService;

  return {
    service: new IdempotencyService(prisma, {
      idempotencyRetentionHours: 24,
    } as LedgerConfig),
    create,
    update,
    created,
    updated,
    transaction,
  };
}

const baseOptions = {
  scope: IDEMPOTENCY_SCOPES.defaultCustomerAccount,
  idempotencyKey: 'provision-account-0123456789',
  payload,
  encode: (value: typeof storedResponse) => value as never,
  decode: (value: unknown) => value as typeof storedResponse,
};

describe('isIdempotencyConflict', () => {
  it('recognises a unique violation on the idempotency constraint', () => {
    expect(
      isIdempotencyConflict(
        new UniqueViolation({
          target: ['idempotency_records_scope_key_hash_key'],
        }),
      ),
    ).toBe(true);
  });

  it('does not claim a customer account collision', () => {
    expect(
      isIdempotencyConflict(
        new UniqueViolation({
          target: ['customer_accounts_customer_id_product_type_currency_key'],
        }),
      ),
    ).toBe(false);
  });

  it('ignores unrelated errors', () => {
    expect(isIdempotencyConflict(new Error('connection reset'))).toBe(false);
    expect(isIdempotencyConflict(undefined)).toBe(false);
  });
});

describe('IdempotencyService.execute', () => {
  it('runs the work once and stores the response', async () => {
    const { service, create, updated } = buildService({
      findUnique: jest.fn(() => Promise.resolve(null)),
    });
    const run = jest.fn(() => Promise.resolve(storedResponse));

    const outcome = await service.execute({ ...baseOptions, run });

    expect(run).toHaveBeenCalledTimes(1);
    expect(outcome.replayed).toBe(false);
    expect(outcome.result).toEqual(storedResponse);
    expect(create).toHaveBeenCalledTimes(1);
    expect(updated[0]).toMatchObject({ status: 'COMPLETED' });
  });

  it('stores only a hash of the key, never the key itself', async () => {
    const { service, created } = buildService({
      findUnique: jest.fn(() => Promise.resolve(null)),
    });
    await service.execute({
      ...baseOptions,
      run: () => Promise.resolve(storedResponse),
    });

    expect(JSON.stringify(created[0])).not.toContain(
      baseOptions.idempotencyKey,
    );
    expect(created[0]?.keyHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(created[0]?.requestHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(created[0]).not.toHaveProperty('responseBody');
  });

  it('replays a completed response without re-running the work', async () => {
    const { service } = buildService({
      findUnique: jest.fn(() =>
        Promise.resolve({
          requestHash: canonicalRequestHash(payload),
          status: 'COMPLETED',
          responseBody: storedResponse,
        }),
      ),
    });
    const run = jest.fn(() => Promise.resolve(storedResponse));

    const outcome = await service.execute({ ...baseOptions, run });

    expect(run).not.toHaveBeenCalled();
    expect(outcome.replayed).toBe(true);
    expect(outcome.result).toEqual(storedResponse);
  });

  it('rejects the same key reused with a different payload', async () => {
    const { service } = buildService({
      findUnique: jest.fn(() =>
        Promise.resolve({
          requestHash: canonicalRequestHash({ customerId: 'different' }),
          status: 'COMPLETED',
          responseBody: storedResponse,
        }),
      ),
    });

    await expect(
      service.execute({
        ...baseOptions,
        run: () => Promise.resolve(storedResponse),
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
  });

  it('reports a concurrent duplicate that has not yet committed', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        requestHash: canonicalRequestHash(payload),
        status: 'IN_PROGRESS',
        responseBody: null,
      });
    const transaction = jest.fn(() =>
      Promise.reject(
        new UniqueViolation({
          target: ['idempotency_records_scope_key_hash_key'],
        }),
      ),
    );
    const { service } = buildService({ findUnique, transaction });

    await expect(
      service.execute({
        ...baseOptions,
        run: () => Promise.resolve(storedResponse),
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS', status: 409 });
  });

  it('replays the winner response when a concurrent duplicate loses the race', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        requestHash: canonicalRequestHash(payload),
        status: 'COMPLETED',
        responseBody: storedResponse,
      });
    const transaction = jest.fn(() =>
      Promise.reject(
        new UniqueViolation({
          target: ['idempotency_records_scope_key_hash_key'],
        }),
      ),
    );
    const { service } = buildService({ findUnique, transaction });

    const outcome = await service.execute({
      ...baseOptions,
      run: () => Promise.resolve(storedResponse),
    });

    expect(outcome.replayed).toBe(true);
    expect(outcome.result).toEqual(storedResponse);
  });

  it('propagates a non-idempotency failure unchanged', async () => {
    const transaction = jest.fn(() =>
      Promise.reject(new Error('deadlock detected')),
    );
    const { service } = buildService({
      findUnique: jest.fn(() => Promise.resolve(null)),
      transaction,
    });

    await expect(
      service.execute({
        ...baseOptions,
        run: () => Promise.resolve(storedResponse),
      }),
    ).rejects.toThrow('deadlock detected');
  });
});
