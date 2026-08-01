import type { PrismaService } from '../database/prisma.service';
import type { JournalService } from '../ledger/journal.service';
import { deterministicAccountOrder } from '../ledger/journal.service';
import { CustomerTransferService } from './customer-transfer.service';

type JournalRequest = Parameters<JournalService['post']>[0];

const senderCustomerId = '11111111-1111-4111-8111-111111111111';
const recipientCustomerId = '22222222-2222-4222-8222-222222222222';
const sourceAccountId = '33333333-3333-4333-8333-333333333333';
const recipientAccountId = '44444444-4444-4444-8444-444444444444';
const sourceLedgerId = '55555555-5555-4555-8555-555555555555';
const recipientLedgerId = '66666666-6666-4666-8666-666666666666';

function account(
  side: 'source' | 'recipient',
  overrides: Record<string, unknown> = {},
) {
  const source = side === 'source';
  return {
    id: source ? sourceAccountId : recipientAccountId,
    customerId: source ? senderCustomerId : recipientCustomerId,
    publicReference: source ? 'AEGIS-SRC1-SRC2-SRC3' : 'AEGIS-DST1-DST2-DST3',
    maskedReference: source ? 'AEGIS-****-****-SRC3' : 'AEGIS-****-****-DST3',
    currency: 'LKR',
    status: 'ACTIVE',
    ledgerAccountId: source ? sourceLedgerId : recipientLedgerId,
    ledgerAccount: {
      accountClass: 'LIABILITY',
      balanceProjection: {
        debitTotalMinor: 0n,
        creditTotalMinor: source ? 1_000n : 250n,
      },
    },
    ...overrides,
  };
}

const command = {
  transferId: '77777777-7777-4777-8777-777777777777',
  transferReference: 'AEGIS-TRF-TEST-0001',
  senderCustomerId,
  sourceAccountId,
  recipientReference: 'AEGIS-DST1-DST2-DST3',
  amountMinor: '1000',
  currency: 'LKR',
  idempotencyKey: 'transfer:77777777-7777-4777-8777-777777777777',
} as const;

function build(
  options: {
    source?: ReturnType<typeof account> | null;
    recipient?: ReturnType<typeof account> | null;
    post?: JournalService['post'];
  } = {},
) {
  const source =
    options.source === undefined ? account('source') : options.source;
  const recipient =
    options.recipient === undefined ? account('recipient') : options.recipient;
  const findFirst = jest.fn(() => Promise.resolve(source));
  const findUnique = jest.fn(() => Promise.resolve(recipient));
  const findUniqueOrThrow = jest.fn(
    ({ where }: { where: { ledgerAccountId: string } }) =>
      Promise.resolve(
        where.ledgerAccountId === sourceLedgerId
          ? { debitTotalMinor: 1_000n, creditTotalMinor: 1_000n }
          : { debitTotalMinor: 0n, creditTotalMinor: 1_250n },
      ),
  );
  const requests: JournalRequest[] = [];
  const implementation: JournalService['post'] =
    options.post ??
    (() =>
      Promise.resolve({
        id: '88888888-8888-4888-8888-888888888888',
        reference: command.transferReference,
        entryType: 'CUSTOMER_TRANSFER',
        currency: 'LKR',
        totalMinor: command.amountMinor,
        effectiveAt: '2026-08-01T10:00:00.000Z',
        createdAt: '2026-08-01T10:00:00.000Z',
        postings: [
          {
            id: '99999999-9999-4999-8999-999999999991',
            ledgerAccountId: sourceLedgerId,
            direction: 'DEBIT',
            amountMinor: command.amountMinor,
            sequence: 0,
          },
          {
            id: '99999999-9999-4999-8999-999999999992',
            ledgerAccountId: recipientLedgerId,
            direction: 'CREDIT',
            amountMinor: command.amountMinor,
            sequence: 1,
          },
        ],
      }));
  const post: JournalService['post'] = async (...args) => {
    requests.push(args[0]);
    return implementation(...args);
  };
  const prisma = {
    client: {
      customerAccount: { findFirst, findUnique },
      balanceProjection: { findUniqueOrThrow },
    },
  } as unknown as PrismaService;
  const journals = { post } as unknown as JournalService;
  return {
    service: new CustomerTransferService(prisma, journals),
    findFirst,
    findUnique,
    post,
    requests,
  };
}

describe('CustomerTransferService', () => {
  it('scopes the source account lookup to the authenticated sender', async () => {
    const { service, findFirst } = build();
    await service.preview(command);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: sourceAccountId, customerId: senderCustomerId },
      }),
    );
  });

  it('conceals a source account not owned by the sender', async () => {
    await expect(
      build({ source: null }).service.preview(command),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_FOUND',
    });
  });

  it.each([
    ['source', account('source', { status: 'FROZEN' }), account('recipient')],
    [
      'recipient',
      account('source'),
      account('recipient', { status: 'CLOSED' }),
    ],
  ])('rejects an inactive %s account', async (_side, source, recipient) => {
    await expect(
      build({ source, recipient }).service.preview(command),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_ACTIVE',
    });
  });

  it('rejects a self-transfer', async () => {
    const recipient = account('recipient', { id: sourceAccountId });
    await expect(
      build({ recipient }).service.preview(command),
    ).rejects.toMatchObject({
      code: 'SELF_TRANSFER',
    });
  });

  it('rejects a currency mismatch', async () => {
    const recipient = account('recipient', { currency: 'USD' });
    await expect(
      build({ recipient }).service.preview(command),
    ).rejects.toMatchObject({
      code: 'CURRENCY_MISMATCH',
    });
  });

  it.each(['0', '-1'])(
    'rejects a non-positive amount of %s',
    async (amountMinor) => {
      await expect(
        build().service.transfer(
          { ...command, amountMinor },
          command.transferId,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    },
  );

  it('rejects insufficient funds without posting a journal', async () => {
    const { service, requests } = build();
    await expect(
      service.transfer({ ...command, amountMinor: '1001' }, command.transferId),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect(requests).toHaveLength(0);
  });

  it('posts an exact-balance transfer with two exact BigInt-safe postings', async () => {
    const { service, requests } = build();
    const result = await service.transfer(command, command.transferId);
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request).toBeDefined();
    expect(request).toMatchObject({
      entryType: 'CUSTOMER_TRANSFER',
      idempotencyKey: command.idempotencyKey,
      postings: [
        {
          ledgerAccountId: sourceLedgerId,
          direction: 'DEBIT',
          amountMinor: '1000',
        },
        {
          ledgerAccountId: recipientLedgerId,
          direction: 'CREDIT',
          amountMinor: '1000',
        },
      ],
      metadata: {
        transferId: command.transferId,
        transferReference: command.transferReference,
      },
    });
    expect(request!.postings).toHaveLength(2);
    expect(JSON.stringify(request!.metadata)).not.toMatch(
      /customerId|publicReference|ledgerAccountId/iu,
    );
    expect(result.senderBalanceAfter.minorUnits).toBe('0');
    expect(result.recipientBalanceAfter.minorUnits).toBe('1250');
  });

  it('preserves values beyond Number.MAX_SAFE_INTEGER as decimal strings', async () => {
    const huge = '9007199254740993';
    const source = account('source', {
      ledgerAccount: {
        accountClass: 'LIABILITY',
        balanceProjection: {
          debitTotalMinor: 0n,
          creditTotalMinor: BigInt(huge),
        },
      },
    });
    let captured: JournalRequest | undefined;
    const post: JournalService['post'] = (request) => {
      captured = request;
      return Promise.resolve({
        id: command.transferId,
        reference: command.transferReference,
        entryType: 'CUSTOMER_TRANSFER',
        currency: 'LKR',
        totalMinor: huge,
        effectiveAt: '2026-08-01T10:00:00.000Z',
        createdAt: '2026-08-01T10:00:00.000Z',
        postings: [
          {
            id: sourceAccountId,
            ledgerAccountId: sourceLedgerId,
            direction: 'DEBIT',
            amountMinor: huge,
            sequence: 0,
          },
          {
            id: recipientAccountId,
            ledgerAccountId: recipientLedgerId,
            direction: 'CREDIT',
            amountMinor: huge,
            sequence: 1,
          },
        ],
      });
    };
    await build({ source, post }).service.transfer(
      { ...command, amountMinor: huge },
      command.transferId,
    );
    expect(captured?.postings[0]?.amountMinor).toBe(huge);
  });

  it('uses deterministic unique account lock ordering', () => {
    expect(
      deterministicAccountOrder([
        recipientLedgerId,
        sourceLedgerId,
        recipientLedgerId,
      ]),
    ).toEqual([sourceLedgerId, recipientLedgerId]);
  });

  it('forwards the same idempotency payload for a lost-response replay', async () => {
    const { service, requests } = build();
    await service.transfer(command, command.transferId);
    await service.transfer(command, command.transferId);
    expect(requests[0]).toEqual(requests[1]);
  });

  it('propagates an idempotency payload conflict without exposing internals', async () => {
    const conflict = Object.assign(new Error('Conflict.'), {
      code: 'IDEMPOTENCY_CONFLICT',
      status: 409,
    });
    const post: JournalService['post'] = () => Promise.reject(conflict);
    await expect(
      build({ post }).service.transfer(command, command.transferId),
    ).rejects.toBe(conflict);
  });
});
