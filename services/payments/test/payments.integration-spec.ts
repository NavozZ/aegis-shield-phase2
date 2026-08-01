import { randomUUID } from 'node:crypto';
import { config as loadEnvironment } from 'dotenv';
import { resolve } from 'node:path';
import {
  createPaymentsConfig,
  type PaymentsConfig,
} from '../src/common/config/payments.config';
import { sha256 } from '../src/common/security/security';
import { PrismaService } from '../src/database/prisma.service';
import { PaymentsReconciliationService } from '../src/reconciliation/payments-reconciliation.service';
import {
  LedgerCallError,
  type LedgerClient,
} from '../src/transfers/ledger.client';
import { TransfersService } from '../src/transfers/transfers.service';

loadEnvironment({
  path: resolve(process.cwd(), '..', '..', '.env.example'),
  quiet: true,
});

type LedgerMode = 'SUCCESS' | 'TERMINAL_FAILURE' | 'UNCERTAIN';

describe('Payments PostgreSQL integration', () => {
  let prisma: PrismaService;
  let baseConfig: PaymentsConfig;
  let service: TransfersService;
  let reconciliation: PaymentsReconciliationService;
  let ledgerMode: LedgerMode = 'SUCCESS';
  let ledgerTransferCalls = 0;
  const senderId = randomUUID();
  const recipientId = randomUUID();
  const sourceAccountId = randomUUID();
  const recipientAccountId = randomUUID();
  const recipientReference = 'AEGIS-ABCD-EFGH-JKLM';
  let completedTransferId: string;

  const ledger = {
    preview: (input: { sourceAccountId: string }) =>
      Promise.resolve({
        sourceAccountId: input.sourceAccountId,
        sourceMaskedReference: 'AEGIS-****-****-SRC1',
        sourceBalance: { currency: 'LKR', minorUnits: '10000000' },
        recipientAccountId,
        recipientCustomerId: recipientId,
        recipientMaskedReference: 'AEGIS-****-****-DST1',
        currency: 'LKR',
      }),
    transfer: (input: { transferId: string; amountMinor: string }) => {
      ledgerTransferCalls += 1;
      if (ledgerMode === 'TERMINAL_FAILURE')
        return Promise.reject(new LedgerCallError(409, 'INSUFFICIENT_FUNDS'));
      if (ledgerMode === 'UNCERTAIN')
        return Promise.reject(new Error('simulated lost response'));
      return Promise.resolve({
        journalId: input.transferId,
        senderPostingId: randomUUID(),
        recipientPostingId: randomUUID(),
        senderAccountId: sourceAccountId,
        recipientAccountId,
        senderMaskedReference: 'AEGIS-****-****-SRC1',
        recipientMaskedReference: 'AEGIS-****-****-DST1',
        senderBalanceAfter: { currency: 'LKR', minorUnits: '9999000' },
        recipientBalanceAfter: {
          currency: 'LKR',
          minorUnits: input.amountMinor,
        },
        currency: 'LKR',
        amount: { currency: 'LKR', minorUnits: input.amountMinor },
        postedAt: new Date().toISOString(),
      });
    },
  } as unknown as LedgerClient;

  async function intentFor(
    senderCustomerId: string,
    amount = '10.00',
    transferService = service,
  ) {
    const preview = await transferService.createIntent(
      {
        senderCustomerId,
        sourceAccountId: randomUUID(),
        recipientReference,
        amount,
      },
      randomUUID(),
    );
    await transferService.authorize(senderCustomerId, preview.intentToken);
    return preview.intentToken;
  }

  beforeAll(async () => {
    baseConfig = createPaymentsConfig();
    prisma = new PrismaService(baseConfig);
    await prisma.onModuleInit();
    service = new TransfersService(prisma, ledger, baseConfig);
    reconciliation = new PaymentsReconciliationService(prisma);
  });

  afterAll(async () => prisma.onModuleDestroy());

  it('uses every committed migration', async () => {
    const tables = await prisma.client.$queryRaw<Array<{ table_name: string }>>`
      SELECT "table_name" FROM "information_schema"."tables"
      WHERE "table_schema" = 'app'
    `;
    const names = tables.map((table) => table.table_name);
    for (const expected of [
      'transfer_intents',
      'transfers',
      'transfer_events',
      'reconciliation_runs',
    ])
      expect(names).toContain(expected);
  });

  it('creates, authorizes and atomically consumes an intent into a completed Transfer', async () => {
    ledgerMode = 'SUCCESS';
    const token = await intentFor(senderId);
    const tokenHash = await prisma.client.transferIntent.findUnique({
      where: { tokenHash: sha256(token) },
    });
    expect(tokenHash?.authorizedAt).not.toBeNull();
    expect(tokenHash).not.toHaveProperty('token');

    const result = await service.confirm(
      {
        senderCustomerId: senderId,
        intentToken: token,
        idempotencyKey: `integration-${randomUUID()}`,
      },
      randomUUID(),
    );
    completedTransferId = result.id;
    expect(result.status).toBe('COMPLETED');
    const stored = await prisma.client.transfer.findUniqueOrThrow({
      where: { id: result.id },
      include: { intent: true, events: true },
    });
    expect(stored.intent.consumedAt).not.toBeNull();
    expect(stored.events.map((event) => event.eventType)).toEqual([
      'AUTHORIZED',
      'PROCESSING_STARTED',
      'LEDGER_POSTED',
      'COMPLETED',
    ]);
  });

  it('replays the exact idempotency key and rejects conflicting reuse', async () => {
    const replaySender = randomUUID();
    const key = `integration-replay-${randomUUID()}`;
    const token = await intentFor(replaySender);
    const first = await service.confirm(
      {
        senderCustomerId: replaySender,
        intentToken: token,
        idempotencyKey: key,
      },
      randomUUID(),
    );
    const calls = ledgerTransferCalls;
    const replay = await service.confirm(
      {
        senderCustomerId: replaySender,
        intentToken: token,
        idempotencyKey: key,
      },
      randomUUID(),
    );
    expect(replay.id).toBe(first.id);
    expect(ledgerTransferCalls).toBe(calls);

    const otherToken = await intentFor(replaySender, '11.00');
    await expect(
      service.confirm(
        {
          senderCustomerId: replaySender,
          intentToken: otherToken,
          idempotencyKey: key,
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('serializes concurrent duplicate confirmation into one Transfer', async () => {
    const concurrentSender = randomUUID();
    const token = await intentFor(concurrentSender);
    const key = `integration-concurrent-${randomUUID()}`;
    const outcomes = await Promise.allSettled([
      service.confirm(
        {
          senderCustomerId: concurrentSender,
          intentToken: token,
          idempotencyKey: key,
        },
        randomUUID(),
      ),
      service.confirm(
        {
          senderCustomerId: concurrentSender,
          intentToken: token,
          idempotencyKey: key,
        },
        randomUUID(),
      ),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(2);
    const fulfilled = outcomes.filter(
      (outcome) => outcome.status === 'fulfilled',
    );
    expect(new Set(fulfilled.map((outcome) => outcome.value.id)).size).toBe(1);
    expect(
      await prisma.client.transfer.count({
        where: {
          senderCustomerId: concurrentSender,
          idempotencyKeyHash: { not: '' },
        },
      }),
    ).toBe(1);
  });

  it('enforces the daily limit under concurrent reservations', async () => {
    const limitedSender = randomUUID();
    const limitedConfig = {
      ...baseConfig,
      maxTransferMinor: 1_500n,
      dailyOutgoingLimitMinor: 1_500n,
    };
    const limited = new TransfersService(prisma, ledger, limitedConfig);
    const [firstToken, secondToken] = await Promise.all([
      intentFor(limitedSender, '10.00', limited),
      intentFor(limitedSender, '10.00', limited),
    ]);
    const outcomes = await Promise.allSettled([
      limited.confirm(
        {
          senderCustomerId: limitedSender,
          intentToken: firstToken,
          idempotencyKey: `daily-a-${randomUUID()}`,
        },
        randomUUID(),
      ),
      limited.confirm(
        {
          senderCustomerId: limitedSender,
          intentToken: secondToken,
          idempotencyKey: `daily-b-${randomUUID()}`,
        },
        randomUUID(),
      ),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      await prisma.client.transfer.count({
        where: { senderCustomerId: limitedSender },
      }),
    ).toBe(1);
  });

  it('persists terminal failure and uncertain processing states', async () => {
    const failedSender = randomUUID();
    ledgerMode = 'TERMINAL_FAILURE';
    const failed = await service.confirm(
      {
        senderCustomerId: failedSender,
        intentToken: await intentFor(failedSender),
        idempotencyKey: `terminal-${randomUUID()}`,
      },
      randomUUID(),
    );
    expect(failed).toMatchObject({
      status: 'FAILED',
      failureCode: 'INSUFFICIENT_FUNDS',
    });

    const processingSender = randomUUID();
    ledgerMode = 'UNCERTAIN';
    const processing = await service.confirm(
      {
        senderCustomerId: processingSender,
        intentToken: await intentFor(processingSender),
        idempotencyKey: `uncertain-${randomUUID()}`,
      },
      randomUUID(),
    );
    expect(processing.status).toBe('PROCESSING');
  });

  it('claims uncertain work once with SKIP LOCKED and converges to COMPLETED', async () => {
    await prisma.client.transfer.updateMany({
      where: { status: 'PROCESSING' },
      data: { nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    const recoverySender = randomUUID();
    ledgerMode = 'UNCERTAIN';
    const processing = await service.confirm(
      {
        senderCustomerId: recoverySender,
        intentToken: await intentFor(recoverySender),
        idempotencyKey: `recover-${randomUUID()}`,
      },
      randomUUID(),
    );
    await prisma.client.$executeRaw`
      UPDATE "app"."transfers"
      SET "updated_at" = CURRENT_TIMESTAMP - INTERVAL '2 minutes',
          "next_attempt_at" = NULL
      WHERE "id" = ${processing.id}::uuid
    `;
    ledgerMode = 'SUCCESS';
    const beforeCalls = ledgerTransferCalls;
    const runs = await Promise.all([service.recover(), service.recover()]);
    expect(runs.reduce((total, run) => total + run.processed, 0)).toBe(1);
    expect(ledgerTransferCalls - beforeCalls).toBe(1);
    await expect(
      prisma.client.transfer.findUniqueOrThrow({
        where: { id: processing.id },
      }),
    ).resolves.toMatchObject({ status: 'COMPLETED', attemptCount: 1 });
  });

  it('moves exhausted uncertain work to REQUIRES_REVIEW', async () => {
    const reviewSender = randomUUID();
    ledgerMode = 'UNCERTAIN';
    const processing = await service.confirm(
      {
        senderCustomerId: reviewSender,
        intentToken: await intentFor(reviewSender),
        idempotencyKey: `review-${randomUUID()}`,
      },
      randomUUID(),
    );
    await prisma.client.$executeRaw`
      UPDATE "app"."transfers"
      SET "attempt_count" = ${baseConfig.maxProcessingAttempts - 1},
          "updated_at" = CURRENT_TIMESTAMP - INTERVAL '2 minutes',
          "next_attempt_at" = NULL
      WHERE "id" = ${processing.id}::uuid
    `;
    await expect(service.recover()).resolves.toEqual({ processed: 1 });
    await expect(
      prisma.client.transfer.findUniqueOrThrow({
        where: { id: processing.id },
      }),
    ).resolves.toMatchObject({ status: 'REQUIRES_REVIEW' });
  });

  it('lists sent/received transfers, paginates, and conceals ownership', async () => {
    const sent = await service.list(senderId, { pageSize: 1 });
    expect(sent.transfers[0]?.direction).toBe('SENT');
    const received = await service.list(recipientId, {
      pageSize: 20,
      direction: 'RECEIVED',
    });
    expect(
      received.transfers.some((item) => item.id === completedTransferId),
    ).toBe(true);
    await expect(
      service.detail(senderId, completedTransferId),
    ).resolves.toMatchObject({
      direction: 'SENT',
    });
    await expect(
      service.detail(randomUUID(), completedTransferId),
    ).rejects.toMatchObject({
      code: 'TRANSFER_NOT_FOUND',
    });
  });

  it('preserves append-only TransferEvent rows', async () => {
    const event = await prisma.client.transferEvent.findFirstOrThrow({
      where: { transferId: completedTransferId },
    });
    await expect(
      prisma.client.$executeRaw`
        UPDATE "app"."transfer_events" SET "safe_code" = 'tampered'
        WHERE "id" = ${event.id}::uuid
      `,
    ).rejects.toThrow();
    await expect(
      prisma.client.$executeRaw`
        DELETE FROM "app"."transfer_events" WHERE "id" = ${event.id}::uuid
      `,
    ).rejects.toThrow();
  });

  it('reconciles valid state and detects a deliberate completed-state violation', async () => {
    const valid = await reconciliation.run();
    expect(valid.status).toBe('PASS');
    await prisma.client.transfer.update({
      where: { id: completedTransferId },
      data: { failureCode: 'INTERNAL_ERROR' },
    });
    try {
      const failed = await reconciliation.run();
      expect(failed.status).toBe('FAIL');
      expect(failed.issues.map((issue) => issue.code)).toContain(
        'COMPLETED_TRANSFER_HAS_FAILURE',
      );
    } finally {
      await prisma.client.transfer.update({
        where: { id: completedTransferId },
        data: { failureCode: null },
      });
    }
    await expect(reconciliation.run()).resolves.toMatchObject({
      status: 'PASS',
    });
  });
});
