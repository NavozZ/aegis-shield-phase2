import type { PaymentsConfig } from '../common/config/payments.config';
import { PaymentsError } from '../common/errors/payments.error';
import { canonicalHash, sha256 } from '../common/security/security';
import type { PrismaService } from '../database/prisma.service';
import { LedgerCallError, type LedgerClient } from './ledger.client';
import { TransfersService } from './transfers.service';
import type { PaymentsRiskClient } from './risk.client';

const senderId = '11111111-1111-4111-8111-111111111111';
const recipientId = '22222222-2222-4222-8222-222222222222';
const sourceAccountId = '33333333-3333-4333-8333-333333333333';
const recipientAccountId = '44444444-4444-4444-8444-444444444444';
const intentId = '55555555-5555-4555-8555-555555555555';
const transferId = '66666666-6666-4666-8666-666666666666';
const correlationId = '77777777-7777-4777-8777-777777777777';
const token = 'a'.repeat(43);

function safeJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
}

const config: PaymentsConfig = {
  nodeEnvironment: 'test',
  host: '127.0.0.1',
  port: 4104,
  databaseUrl: 'postgresql://test',
  internalToken: 'test-only-payments-token',
  ledgerServiceUrl: 'http://127.0.0.1:4102',
  ledgerInternalToken: 'test-only-ledger-token',
  minTransferMinor: 100n,
  maxTransferMinor: 5_000_000n,
  dailyOutgoingLimitMinor: 10_000n,
  intentTtlSeconds: 300,
  httpTimeoutMs: 1000,
  recoveryStaleSeconds: 30,
  maxProcessingAttempts: 3,
  idempotencyRetentionHours: 24,
  riskServiceUrl: 'http://127.0.0.1:4105',
  riskInternalToken: 'test-only-risk-token',
  riskPaymentsSourceToken: 'test-only-payments-source',
  riskTimeoutMs: 1000,
};

function intent(overrides: Record<string, unknown> = {}) {
  return {
    id: intentId,
    tokenHash: sha256(token),
    senderCustomerId: senderId,
    sourceAccountId,
    recipientPublicReference: 'AEGIS-ABCD-EFGH-JKLM',
    sourceMaskedReference: 'AEGIS-****-****-SRC1',
    recipientMaskedReference: 'AEGIS-****-****-DST1',
    recipientCustomerId: recipientId,
    recipientAccountId,
    currency: 'LKR',
    amountMinor: 1_000n,
    sourceBalanceSnapshotMinor: 5_000n,
    expiresAt: new Date(Date.now() + 60_000),
    authorizedAt: new Date(),
    consumedAt: null,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    updatedAt: new Date('2026-08-01T10:00:00.000Z'),
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: transferId,
    intentId,
    displayReference: 'AEGIS-TRF-ABCD-EFGH-JKLM',
    senderCustomerId: senderId,
    recipientCustomerId: recipientId,
    senderAccountId: sourceAccountId,
    recipientAccountId,
    senderMaskedReference: 'AEGIS-****-****-SRC1',
    recipientMaskedReference: 'AEGIS-****-****-DST1',
    recipientPublicReference: 'AEGIS-ABCD-EFGH-JKLM',
    currency: 'LKR',
    amountMinor: 1_000n,
    status: 'PROCESSING',
    failureCode: null,
    failureMessageCode: null,
    ledgerJournalId: null,
    senderPostingId: null,
    recipientPostingId: null,
    senderBalanceAfterMinor: null,
    recipientBalanceAfterMinor: null,
    idempotencyKeyHash: sha256('transfer-confirm-key-0001'),
    requestHash: canonicalHash({
      senderCustomerId: senderId,
      intentId,
      sourceAccountId,
      recipientAccountId,
      amountMinor: '1000',
      currency: 'LKR',
    }),
    correlationId,
    attemptCount: 0,
    nextAttemptAt: null,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    updatedAt: new Date('2026-08-01T10:00:00.000Z'),
    completedAt: null,
    failedAt: null,
    ...overrides,
  };
}

function ledgerResult() {
  return {
    journalId: '88888888-8888-4888-8888-888888888888',
    senderPostingId: '99999999-9999-4999-8999-999999999991',
    recipientPostingId: '99999999-9999-4999-8999-999999999992',
    senderAccountId: sourceAccountId,
    recipientAccountId,
    senderMaskedReference: 'AEGIS-****-****-SRC1',
    recipientMaskedReference: 'AEGIS-****-****-DST1',
    senderBalanceAfter: { currency: 'LKR', minorUnits: '4000' },
    recipientBalanceAfter: { currency: 'LKR', minorUnits: '1000' },
    currency: 'LKR',
    amount: { currency: 'LKR', minorUnits: '1000' },
    postedAt: '2026-08-01T10:01:00.000Z',
  };
}

function build(
  options: {
    storedIntent?: ReturnType<typeof intent> | null;
    existing?: ReturnType<typeof row> | null;
    dailyReserved?: bigint;
    ledgerTransfer?: () => Promise<ReturnType<typeof ledgerResult>>;
  } = {},
) {
  const storedIntent =
    options.storedIntent === undefined ? intent() : options.storedIntent;
  const createdIntents: Array<Record<string, unknown>> = [];
  const createdTransfers: Array<Record<string, unknown>> = [];
  const transferUpdates: Array<Record<string, unknown>> = [];
  const transferIntentCreate = jest.fn(
    ({ data }: { data: Record<string, unknown> }) => {
      createdIntents.push(data);
      return Promise.resolve({ id: intentId, ...data });
    },
  );
  const recoveryQuery = jest.fn<Promise<Array<{ id: string }>>, unknown[]>(() =>
    Promise.resolve([]),
  );
  const transferFindMany = jest.fn<
    Promise<Array<ReturnType<typeof row>>>,
    [unknown?]
  >(() => Promise.resolve([]));
  const transferCreate = jest.fn(
    ({ data }: { data: Record<string, unknown> }) => {
      createdTransfers.push(data);
      return Promise.resolve(row());
    },
  );
  const applyTransferUpdate = ({ data }: { data: Record<string, unknown> }) => {
    transferUpdates.push(data);
    const status = typeof data.status === 'string' ? data.status : 'PROCESSING';
    return Promise.resolve(
      row({
        status,
        ledgerJournalId: data.ledgerJournalId ?? null,
        senderPostingId: data.senderPostingId ?? null,
        recipientPostingId: data.recipientPostingId ?? null,
        senderBalanceAfterMinor: data.senderBalanceAfterMinor ?? null,
        recipientBalanceAfterMinor: data.recipientBalanceAfterMinor ?? null,
        failureCode: data.failureCode ?? null,
        completedAt: data.completedAt ?? null,
      }),
    );
  };
  const tx = {
    $executeRaw: jest.fn(() => Promise.resolve(1)),
    $queryRaw: recoveryQuery,
    transferIntent: {
      findFirst: jest.fn(() => Promise.resolve(storedIntent)),
      update: jest.fn(() => Promise.resolve(storedIntent)),
    },
    transfer: {
      findUnique: jest.fn(() => Promise.resolve(options.existing ?? null)),
      findUniqueOrThrow: jest.fn(() => Promise.resolve(row())),
      aggregate: jest.fn(() =>
        Promise.resolve({ _sum: { amountMinor: options.dailyReserved ?? 0n } }),
      ),
      create: transferCreate,
      update: jest.fn(applyTransferUpdate),
    },
  };
  const client = {
    $transaction: jest.fn(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    ),
    transferIntent: {
      create: transferIntentCreate,
      findFirst: jest.fn(() => Promise.resolve(storedIntent)),
      update: jest.fn(() => Promise.resolve(storedIntent)),
    },
    transfer: {
      update: jest.fn(applyTransferUpdate),
      findUnique: jest.fn(() => Promise.resolve(options.existing ?? null)),
      findMany: transferFindMany,
      findFirst: jest.fn<Promise<ReturnType<typeof row> | null>, [unknown?]>(
        () => Promise.resolve(null),
      ),
    },
  };
  const preview = jest.fn(() =>
    Promise.resolve({
      sourceAccountId,
      sourceMaskedReference: 'AEGIS-****-****-SRC1',
      sourceBalance: { currency: 'LKR', minorUnits: '5000' },
      recipientAccountId,
      recipientCustomerId: recipientId,
      recipientMaskedReference: 'AEGIS-****-****-DST1',
      currency: 'LKR',
    }),
  );
  const transfer = jest.fn(
    options.ledgerTransfer ?? (() => Promise.resolve(ledgerResult())),
  );
  const prisma = { client } as unknown as PrismaService;
  const ledger = { preview, transfer } as unknown as LedgerClient;
  const riskEnforce = jest.fn().mockResolvedValue({ decision: 'ALLOW' });
  return {
    service: new TransfersService(prisma, ledger, config, {
      enforce: riskEnforce,
      emit: jest.fn().mockResolvedValue(undefined),
    } as unknown as PaymentsRiskClient),
    client,
    tx,
    preview,
    transfer,
    createdIntents,
    createdTransfers,
    transferUpdates,
    riskEnforce,
  };
}

const previewRequest = {
  senderCustomerId: senderId,
  sourceAccountId,
  recipientReference: 'AEGIS-ABCD-EFGH-JKLM',
  amount: '10.00',
} as const;
const confirmation = {
  senderCustomerId: senderId,
  intentToken: token,
  idempotencyKey: 'transfer-confirm-key-0001',
} as const;

describe('TransfersService', () => {
  it('publishes exact minimum, maximum and daily policy limits', () => {
    expect(build().service.policy()).toEqual({
      currency: 'LKR',
      minimum: { currency: 'LKR', minorUnits: '100' },
      maximum: { currency: 'LKR', minorUnits: '5000000' },
      dailyOutgoingMaximum: { currency: 'LKR', minorUnits: '10000' },
    });
  });

  it('creates a one-time intent and stores only its SHA-256 token hash', async () => {
    const { service, createdIntents, preview } = build();
    const result = await service.createIntent(previewRequest, correlationId);
    expect(result.intentToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(createdIntents).toHaveLength(1);
    expect(createdIntents[0]?.tokenHash).toBe(sha256(result.intentToken));
    expect(safeJson(createdIntents[0])).not.toContain(result.intentToken);
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinor: '1000' }),
      correlationId,
    );
  });

  it.each(['0.99', '50000.01'])(
    'rejects an amount outside policy: %s',
    async (amount) => {
      await expect(
        build().service.createIntent(
          { ...previewRequest, amount },
          correlationId,
        ),
      ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    },
  );

  it.each([
    ['wrong customer', null],
    ['expired', intent({ expiresAt: new Date(Date.now() - 1) })],
    ['consumed', intent({ consumedAt: new Date() })],
  ])('rejects authorization for a %s intent', async (_case, storedIntent) => {
    const harness = build({ storedIntent });
    harness.client.transferIntent.findFirst.mockResolvedValueOnce(null);
    await expect(
      harness.service.authorize(senderId, token),
    ).rejects.toMatchObject({
      code: 'INTENT_EXPIRED',
    });
  });

  it('allows step-up authorization to replay an already-created transfer', async () => {
    const harness = build({ storedIntent: intent({ consumedAt: new Date() }) });
    harness.client.transfer.findFirst.mockResolvedValueOnce(row());
    await expect(
      harness.service.authorize(senderId, token),
    ).resolves.toBeUndefined();
    expect(harness.client.transferIntent.update).not.toHaveBeenCalled();
  });

  it('creates PROCESSING then transitions to COMPLETED with safe public data', async () => {
    const { service, createdTransfers, transfer } = build();
    const result = await service.confirm(confirmation, correlationId);
    expect(createdTransfers[0]).toMatchObject({
      status: 'PROCESSING',
      senderCustomerId: senderId,
    });
    expect(safeJson(createdTransfers[0])).toContain('PROCESSING_STARTED');
    expect(transfer).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: '1000',
        idempotencyKey: `transfer:${transferId}`,
      }),
      correlationId,
    );
    expect(result).toMatchObject({
      status: 'COMPLETED',
      direction: 'SENT',
      balanceAfter: { minorUnits: '4000' },
    });
    for (const forbidden of [
      'senderCustomerId',
      'recipientCustomerId',
      'ledgerJournalId',
      'recipientPublicReference',
      'idempotencyKeyHash',
      'requestHash',
    ])
      expect(result).not.toHaveProperty(forbidden);
  });

  it('transitions a terminal Ledger rejection to FAILED', async () => {
    const harness = build({
      ledgerTransfer: () =>
        Promise.reject(new LedgerCallError(409, 'INSUFFICIENT_FUNDS')),
    });
    const result = await harness.service.confirm(confirmation, correlationId);
    expect(result).toMatchObject({
      status: 'FAILED',
      failureCode: 'INSUFFICIENT_FUNDS',
    });
  });

  it('keeps an uncertain Ledger outcome in PROCESSING', async () => {
    const harness = build({
      ledgerTransfer: () => Promise.reject(new Error('connection lost')),
    });
    const result = await harness.service.confirm(confirmation, correlationId);
    expect(result.status).toBe('PROCESSING');
    expect(result.failureCode).toBeNull();
  });

  it('allows the exact daily limit and rejects one minor unit above it', async () => {
    await expect(
      build({ dailyReserved: 9_000n }).service.confirm(
        confirmation,
        correlationId,
      ),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
    await expect(
      build({ dailyReserved: 9_001n }).service.confirm(
        confirmation,
        correlationId,
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('replays the same idempotency key and rejects a changed payload', async () => {
    const replay = build({
      existing: row({ status: 'COMPLETED' }),
      storedIntent: intent({ consumedAt: new Date() }),
    });
    await expect(
      replay.service.confirm(confirmation, correlationId),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(replay.riskEnforce).not.toHaveBeenCalled();
    await expect(
      build({ existing: row({ requestHash: 'different' }) }).service.confirm(
        confirmation,
        correlationId,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('maps sent and received lists and binds cursors to filters', async () => {
    const harness = build();
    harness.client.transfer.findMany.mockResolvedValue([
      row({ id: '60000000-0000-4000-8000-000000000001' }),
      row({
        id: '60000000-0000-4000-8000-000000000002',
        senderCustomerId: recipientId,
        recipientCustomerId: senderId,
      }),
    ]);
    const result = await harness.service.list(senderId, { pageSize: 1 });
    expect(result.transfers[0]?.direction).toBe('SENT');
    expect(result.nextCursor).toBeTruthy();
    const received = await harness.service.list(senderId, {
      pageSize: 20,
      direction: 'RECEIVED',
    });
    expect(received.transfers).toHaveLength(1);
    expect(received.transfers[0]?.direction).toBe('RECEIVED');
    await expect(
      harness.service.list(senderId, {
        pageSize: 20,
        direction: 'SENT',
        cursor: result.nextCursor!,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('claims stale rows with SKIP LOCKED and completes recovery', async () => {
    const harness = build();
    harness.tx.$queryRaw.mockResolvedValue([{ id: transferId }]);
    harness.tx.transfer.findUniqueOrThrow.mockResolvedValue(row());
    harness.tx.transfer.update.mockImplementation(({ data }) =>
      Promise.resolve(row({ attemptCount: 1, ...data })),
    );
    await expect(harness.service.recover()).resolves.toEqual({ processed: 1 });
    expect(harness.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(harness.transfer).toHaveBeenCalledTimes(1);
    expect(
      harness.transferUpdates.some((update) => update.status === 'COMPLETED'),
    ).toBe(true);
  });

  it('moves a stale row to REQUIRES_REVIEW at the attempt limit', async () => {
    const harness = build();
    harness.tx.$queryRaw.mockResolvedValue([{ id: transferId }]);
    harness.tx.transfer.findUniqueOrThrow.mockResolvedValue(
      row({ attemptCount: 2 }),
    );
    await expect(harness.service.recover()).resolves.toEqual({ processed: 1 });
    expect(
      harness.transferUpdates.some(
        (update) => update.status === 'REQUIRES_REVIEW',
      ),
    ).toBe(true);
    expect(harness.transfer).not.toHaveBeenCalled();
  });

  it('never converts transfer money through Number, parseInt or parseFloat', () => {
    const source = TransfersService.toString();
    expect(source).not.toMatch(/\bNumber\s*\(|parseInt\s*\(|parseFloat\s*\(/u);
  });

  it('rejects an unauthorized confirmation before creating a Transfer', async () => {
    await expect(
      build({ storedIntent: intent({ authorizedAt: null }) }).service.confirm(
        confirmation,
        correlationId,
      ),
    ).rejects.toBeInstanceOf(PaymentsError);
  });
});
