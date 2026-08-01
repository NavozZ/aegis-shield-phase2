import {
  lkrAmountToMinorUnits,
  transferDetailSchema,
  transferListResponseSchema,
  transferPolicySchema,
  transferPreviewResponseSchema,
  type InternalTransferConfirmation,
  type InternalTransferIntentRequest,
  type TransferDetail,
  type TransferListQuery,
  type TransferListResponse,
  type TransferPreviewResponse,
  type TransferSummary,
} from '@aegis/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  PAYMENTS_CONFIG,
  type PaymentsConfig,
} from '../common/config/payments.config';
import { PaymentsError } from '../common/errors/payments.error';
import {
  advisoryKey,
  canonicalHash,
  newIntentToken,
  newTransferReference,
  sha256,
} from '../common/security/security';
import { PrismaService } from '../database/prisma.service';
import type { TransferFailureCode } from '../generated/prisma/client';
import { LedgerCallError, LedgerClient } from './ledger.client';

type TransferRow = {
  id: string;
  intentId: string;
  displayReference: string;
  senderCustomerId: string;
  recipientCustomerId: string;
  senderAccountId: string;
  recipientAccountId: string;
  senderMaskedReference: string;
  recipientMaskedReference: string;
  recipientPublicReference: string;
  currency: string;
  amountMinor: bigint;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REQUIRES_REVIEW';
  failureCode: TransferFailureCode | null;
  senderPostingId: string | null;
  recipientPostingId: string | null;
  senderBalanceAfterMinor: bigint | null;
  recipientBalanceAfterMinor: bigint | null;
  createdAt: Date;
  completedAt: Date | null;
  correlationId: string;
  attemptCount: number;
};

function safeFailure(
  code: string | undefined,
):
  | 'INSUFFICIENT_FUNDS'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_NOT_ACTIVE'
  | 'CURRENCY_MISMATCH'
  | 'SELF_TRANSFER'
  | 'LIMIT_EXCEEDED'
  | 'INTENT_EXPIRED'
  | 'AUTHORIZATION_FAILED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'LEDGER_UNAVAILABLE'
  | 'PROCESSING_TIMEOUT'
  | 'INTERNAL_ERROR' {
  switch (code) {
    case 'INSUFFICIENT_FUNDS':
    case 'ACCOUNT_NOT_FOUND':
    case 'ACCOUNT_NOT_ACTIVE':
    case 'CURRENCY_MISMATCH':
    case 'SELF_TRANSFER':
    case 'LIMIT_EXCEEDED':
    case 'INTENT_EXPIRED':
    case 'AUTHORIZATION_FAILED':
    case 'IDEMPOTENCY_CONFLICT':
      return code;
    default:
      return 'LEDGER_UNAVAILABLE';
  }
}

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerClient,
    @Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig,
  ) {}

  policy() {
    return transferPolicySchema.parse({
      currency: 'LKR',
      minimum: {
        currency: 'LKR',
        minorUnits: this.config.minTransferMinor.toString(),
      },
      maximum: {
        currency: 'LKR',
        minorUnits: this.config.maxTransferMinor.toString(),
      },
      dailyOutgoingMaximum: {
        currency: 'LKR',
        minorUnits: this.config.dailyOutgoingLimitMinor.toString(),
      },
    });
  }
  private assertAmount(amountMinor: bigint) {
    if (
      amountMinor < this.config.minTransferMinor ||
      amountMinor > this.config.maxTransferMinor
    )
      throw new PaymentsError('LIMIT_EXCEEDED');
  }
  private asSummary(row: TransferRow, customerId: string): TransferSummary {
    const sent = row.senderCustomerId === customerId;
    return {
      id: row.id,
      displayReference: row.displayReference,
      direction: sent ? 'SENT' : 'RECEIVED',
      status: row.status,
      accountId: sent ? row.senderAccountId : row.recipientAccountId,
      counterpartyMaskedReference: sent
        ? row.recipientMaskedReference
        : row.senderMaskedReference,
      amount: {
        currency: row.currency,
        minorUnits: row.amountMinor.toString(),
      },
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }
  private asDetail(row: TransferRow, customerId: string): TransferDetail {
    const sent = row.senderCustomerId === customerId;
    return transferDetailSchema.parse({
      ...this.asSummary(row, customerId),
      transactionId: sent ? row.senderPostingId : row.recipientPostingId,
      balanceAfter:
        (sent
          ? row.senderBalanceAfterMinor
          : row.recipientBalanceAfterMinor) === null
          ? null
          : {
              currency: row.currency,
              minorUnits: (sent
                ? row.senderBalanceAfterMinor
                : row.recipientBalanceAfterMinor)!.toString(),
            },
      failureCode: row.failureCode ?? null,
      ownMaskedReference: sent
        ? row.senderMaskedReference
        : row.recipientMaskedReference,
    });
  }

  async createIntent(
    input: InternalTransferIntentRequest,
    correlationId: string,
  ): Promise<TransferPreviewResponse> {
    const amountMinor = BigInt(lkrAmountToMinorUnits(input.amount));
    this.assertAmount(amountMinor);
    let preview;
    try {
      preview = await this.ledger.preview(
        {
          senderCustomerId: input.senderCustomerId,
          sourceAccountId: input.sourceAccountId,
          recipientReference: input.recipientReference,
          amountMinor: amountMinor.toString(),
          currency: 'LKR',
        },
        correlationId,
      );
    } catch (error) {
      if (error instanceof LedgerCallError)
        throw new PaymentsError('ACCOUNT_NOT_FOUND');
      throw error;
    }
    if (preview.sourceAccountId === preview.recipientAccountId)
      throw new PaymentsError('SELF_TRANSFER');
    const token = newIntentToken();
    const expiresAt = new Date(
      Date.now() + this.config.intentTtlSeconds * 1000,
    );
    await this.prisma.client.transferIntent.create({
      data: {
        tokenHash: sha256(token),
        senderCustomerId: input.senderCustomerId,
        sourceAccountId: preview.sourceAccountId,
        recipientPublicReference: input.recipientReference,
        sourceMaskedReference: preview.sourceMaskedReference,
        recipientMaskedReference: preview.recipientMaskedReference,
        recipientCustomerId: preview.recipientCustomerId,
        recipientAccountId: preview.recipientAccountId,
        currency: preview.currency,
        amountMinor,
        sourceBalanceSnapshotMinor: BigInt(preview.sourceBalance.minorUnits),
        expiresAt,
      },
    });
    return transferPreviewResponseSchema.parse({
      intentToken: token,
      sourceMaskedReference: preview.sourceMaskedReference,
      recipientMaskedReference: preview.recipientMaskedReference,
      amount: {
        currency: preview.currency,
        minorUnits: amountMinor.toString(),
      },
      sourceBalance: preview.sourceBalance,
      policy: this.policy(),
      expiresAt: expiresAt.toISOString(),
    });
  }

  async authorize(senderCustomerId: string, token: string): Promise<void> {
    const intent = await this.prisma.client.transferIntent.findFirst({
      where: {
        tokenHash: sha256(token),
        senderCustomerId,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!intent) throw new PaymentsError('INTENT_EXPIRED');
    await this.prisma.client.transferIntent.update({
      where: { id: intent.id },
      data: { authorizedAt: new Date() },
    });
  }

  private async settle(
    row: TransferRow,
    correlationId: string,
  ): Promise<TransferRow> {
    try {
      const result = await this.ledger.transfer(
        {
          transferId: row.id,
          transferReference: row.displayReference,
          senderCustomerId: row.senderCustomerId,
          sourceAccountId: row.senderAccountId,
          recipientReference: row.recipientPublicReference,
          amountMinor: row.amountMinor.toString(),
          currency: row.currency,
          idempotencyKey: `transfer:${row.id}`,
        },
        correlationId,
      );
      return (await this.prisma.client.transfer.update({
        where: { id: row.id },
        data: {
          status: 'COMPLETED',
          ledgerJournalId: result.journalId,
          senderPostingId: result.senderPostingId,
          recipientPostingId: result.recipientPostingId,
          senderBalanceAfterMinor: BigInt(result.senderBalanceAfter.minorUnits),
          recipientBalanceAfterMinor: BigInt(
            result.recipientBalanceAfter.minorUnits,
          ),
          completedAt: new Date(),
          nextAttemptAt: null,
          events: {
            create: [
              {
                eventType: 'LEDGER_POSTED',
                previousStatus: 'PROCESSING',
                nextStatus: 'COMPLETED',
                occurredAt: new Date(),
              },
              {
                eventType: 'COMPLETED',
                previousStatus: 'PROCESSING',
                nextStatus: 'COMPLETED',
                occurredAt: new Date(),
              },
            ],
          },
        },
      })) as TransferRow;
    } catch (error) {
      if (error instanceof LedgerCallError && error.status < 500) {
        return (await this.prisma.client.transfer.update({
          where: { id: row.id },
          data: {
            status: 'FAILED',
            failureCode: safeFailure(error.code),
            failedAt: new Date(),
            nextAttemptAt: null,
            events: {
              create: {
                eventType: 'FAILED',
                previousStatus: 'PROCESSING',
                nextStatus: 'FAILED',
                safeCode: safeFailure(error.code),
                occurredAt: new Date(),
              },
            },
          },
        })) as TransferRow;
      }
      return row;
    }
  }

  async confirm(
    input: InternalTransferConfirmation,
    correlationId: string,
  ): Promise<TransferDetail> {
    const keyHash = sha256(input.idempotencyKey);
    const tokenHash = sha256(input.intentToken);
    const prepared = await this.prisma.client.$transaction(async (tx) => {
      const intent = await tx.transferIntent.findFirst({
        where: { tokenHash, senderCustomerId: input.senderCustomerId },
      });
      if (!intent) throw new PaymentsError('INTENT_EXPIRED');
      const requestHash = canonicalHash({
        senderCustomerId: input.senderCustomerId,
        intentId: intent.id,
        sourceAccountId: intent.sourceAccountId,
        recipientAccountId: intent.recipientAccountId,
        amountMinor: intent.amountMinor.toString(),
        currency: intent.currency,
      });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryKey(`${input.senderCustomerId}:${new Date().toISOString().slice(0, 10)}`)})`;
      const existing = await tx.transfer.findUnique({
        where: {
          senderCustomerId_idempotencyKeyHash: {
            senderCustomerId: input.senderCustomerId,
            idempotencyKeyHash: keyHash,
          },
        },
      });
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new PaymentsError('IDEMPOTENCY_CONFLICT');
        return { row: existing as TransferRow, replayed: true };
      }
      if (
        intent.expiresAt <= new Date() ||
        intent.consumedAt ||
        !intent.authorizedAt
      )
        throw new PaymentsError('INTENT_EXPIRED');
      const reserved = await tx.transfer.aggregate({
        where: {
          senderCustomerId: input.senderCustomerId,
          status: { in: ['PROCESSING', 'COMPLETED', 'REQUIRES_REVIEW'] },
          createdAt: {
            gte: new Date(
              `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
            ),
          },
        },
        _sum: { amountMinor: true },
      });
      if (
        (reserved._sum.amountMinor ?? 0n) + intent.amountMinor >
        this.config.dailyOutgoingLimitMinor
      )
        throw new PaymentsError('LIMIT_EXCEEDED');
      const row = await tx.transfer.create({
        data: {
          displayReference: newTransferReference(),
          senderCustomerId: input.senderCustomerId,
          recipientCustomerId: intent.recipientCustomerId,
          senderAccountId: intent.sourceAccountId,
          recipientAccountId: intent.recipientAccountId,
          senderMaskedReference: intent.sourceMaskedReference,
          recipientMaskedReference: intent.recipientMaskedReference,
          recipientPublicReference: intent.recipientPublicReference,
          currency: intent.currency,
          amountMinor: intent.amountMinor,
          status: 'PROCESSING',
          idempotencyKeyHash: keyHash,
          requestHash,
          intentId: intent.id,
          correlationId,
          events: {
            create: [
              { eventType: 'AUTHORIZED', occurredAt: new Date() },
              {
                eventType: 'PROCESSING_STARTED',
                nextStatus: 'PROCESSING',
                occurredAt: new Date(),
              },
            ],
          },
        },
      });
      await tx.transferIntent.update({
        where: { id: intent.id },
        data: { consumedAt: new Date() },
      });
      return { row: row as TransferRow, replayed: false };
    });
    if (prepared.replayed || prepared.row.status !== 'PROCESSING')
      return this.asDetail(prepared.row, input.senderCustomerId);
    return this.asDetail(
      await this.settle(prepared.row, correlationId),
      input.senderCustomerId,
    );
  }

  async list(
    customerId: string,
    query: TransferListQuery,
  ): Promise<TransferListResponse> {
    const filter = JSON.stringify({
      direction: query.direction,
      status: query.status,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });
    let cursor: { createdAt: string; id: string; filter: string } | undefined;
    if (query.cursor) {
      try {
        cursor = JSON.parse(
          Buffer.from(query.cursor, 'base64url').toString('utf8'),
        ) as typeof cursor;
        if (
          !cursor ||
          cursor.filter !== filter ||
          !/^[-a-f0-9]{36}$/u.test(cursor.id)
        )
          throw new Error();
      } catch {
        throw new PaymentsError(
          'INVALID_REQUEST',
          'The request is invalid.',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    const rows = await this.prisma.client.transfer.findMany({
      where: {
        OR: [
          { senderCustomerId: customerId },
          { recipientCustomerId: customerId },
        ],
        ...(query.status ? { status: query.status } : {}),
        ...(query.dateFrom || query.dateTo
          ? {
              createdAt: {
                ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
                ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 500,
    });
    const directionFiltered = rows.filter(
      (row) =>
        !query.direction ||
        (query.direction === 'SENT'
          ? row.senderCustomerId === customerId
          : row.recipientCustomerId === customerId),
    );
    const after = cursor
      ? directionFiltered.filter(
          (row) =>
            row.createdAt < new Date(cursor.createdAt) ||
            (row.createdAt.getTime() === new Date(cursor.createdAt).getTime() &&
              row.id < cursor.id),
        )
      : directionFiltered;
    const page = after.slice(0, query.pageSize);
    const tail = page.at(-1);
    return transferListResponseSchema.parse({
      transfers: page.map((row) =>
        this.asSummary(row as TransferRow, customerId),
      ),
      nextCursor:
        tail && after.length > page.length
          ? Buffer.from(
              JSON.stringify({
                createdAt: tail.createdAt.toISOString(),
                id: tail.id,
                filter,
              }),
            ).toString('base64url')
          : null,
    });
  }
  async detail(customerId: string, id: string): Promise<TransferDetail> {
    const row = await this.prisma.client.transfer.findFirst({
      where: {
        id,
        OR: [
          { senderCustomerId: customerId },
          { recipientCustomerId: customerId },
        ],
      },
    });
    if (!row)
      throw new PaymentsError(
        'TRANSFER_NOT_FOUND',
        'The transfer could not be found.',
        HttpStatus.NOT_FOUND,
      );
    return this.asDetail(row as TransferRow, customerId);
  }
  async recover(): Promise<{ processed: number }> {
    const claimed = await this.prisma.client.$transaction(async (tx) => {
      const staleBefore = new Date(
        Date.now() - this.config.recoveryStaleSeconds * 1000,
      );
      const ids = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "app"."transfers"
        WHERE "status" = 'PROCESSING'
          AND "updated_at" < ${staleBefore}
          AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= CURRENT_TIMESTAMP)
        ORDER BY "updated_at", "id"
        FOR UPDATE SKIP LOCKED
        LIMIT 20
      `;
      const rows: TransferRow[] = [];
      for (const { id } of ids) {
        const current = (await tx.transfer.findUniqueOrThrow({
          where: { id },
        })) as TransferRow;
        const nextAttempt = current.attemptCount + 1;
        if (nextAttempt >= this.config.maxProcessingAttempts) {
          await tx.transfer.update({
            where: { id },
            data: {
              status: 'REQUIRES_REVIEW',
              attemptCount: nextAttempt,
              nextAttemptAt: null,
              events: {
                create: {
                  eventType: 'REQUIRES_REVIEW',
                  previousStatus: 'PROCESSING',
                  nextStatus: 'REQUIRES_REVIEW',
                  occurredAt: new Date(),
                },
              },
            },
          });
          continue;
        }
        rows.push(
          (await tx.transfer.update({
            where: { id },
            data: {
              attemptCount: nextAttempt,
              nextAttemptAt: new Date(
                Date.now() + this.config.recoveryStaleSeconds * 1000,
              ),
              events: {
                create: {
                  eventType: 'RECOVERY_RETRY',
                  occurredAt: new Date(),
                },
              },
            },
          })) as TransferRow,
        );
      }
      return { selected: ids.length, retry: rows };
    });
    for (const row of claimed.retry) await this.settle(row, row.correlationId);
    return { processed: claimed.selected };
  }
}
