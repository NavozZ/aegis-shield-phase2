/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/no-unused-vars, prettier/prettier, @typescript-eslint/no-unsafe-enum-comparison */
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  PAYMENTS_CONFIG,
  type PaymentsConfig,
} from '../common/config/payments.config';
import { PaymentsError } from '../common/errors/payments.error';
import * as crypto from 'node:crypto';
import { canonicalHash, newIntentToken } from '../common/security/security';
import { PrismaService } from '../database/prisma.service';
import { LedgerClient, LedgerCallError } from '../transfers/ledger.client';

export function sha256(value: string): string {
  return crypto
    .createHash('sha256')
    .update(value, 'utf8')
    .digest('hex');
}

@Injectable()
export class AgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerClient,
    @Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig,
  ) {}

  /**
   * Preview an agent cash operation (in or out).
   */
  async preview(
    input: {
      agentId: string;
      agentReference: string;
      customerReference: string;
      amountMinor: string;
      currency: string;
      operationType: 'AGENT_CASH_IN' | 'AGENT_CASH_OUT';
    },
    correlationId: string,
  ) {
    const amount = BigInt(input.amountMinor);

    if (amount < this.config.minTransferMinor) {
      throw new PaymentsError(
        'INVALID_REQUEST',
        'Amount is below minimum.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (amount > this.config.maxTransferMinor) {
      throw new PaymentsError(
        'LIMIT_EXCEEDED',
        'Amount exceeds maximum per transaction limit.',
        HttpStatus.FORBIDDEN,
      );
    }

    // Resolve customer reference via Ledger
    let customerInfo;
    try {
      customerInfo = await this.ledger.resolveAccountByReference(
        input.customerReference,
        correlationId,
      );
    } catch (error) {
      if (
        error instanceof LedgerCallError &&
        error.status === HttpStatus.NOT_FOUND
      ) {
        throw new PaymentsError(
          'ACCOUNT_NOT_FOUND',
          'Customer account not found.',
          HttpStatus.NOT_FOUND,
        );
      }
      throw error;
    }

    // Check agent limits (daily velocity)
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const dailyOperations =
      await this.prisma.client.agentCashOperation.aggregate({
        where: {
          agentId: input.agentId,
          status: { in: ['COMPLETED'] },
          createdAt: { gte: today },
        },
        _sum: {
          amountMinor: true,
        },
      });

    const dailyTotal = dailyOperations._sum.amountMinor ?? 0n;

    if (dailyTotal + amount > this.config.dailyOutgoingLimitMinor) {
      throw new PaymentsError(
        'LIMIT_EXCEEDED',
        'Daily agent limit exceeded.',
        HttpStatus.FORBIDDEN,
      );
    }

    const intentToken = newIntentToken();
    const expiresAt = new Date(
      Date.now() + this.config.intentTtlSeconds * 1000,
    );
    const displayReference = this.generateReference();

    const intentTokenHash = sha256(intentToken);

    // Using a fake idempotency key to satisfy the db constraints until confirm
    const tempIdempotencyHash = sha256(`temp-${displayReference}`);

    const operation = await this.prisma.client.agentCashOperation.create({
      data: {
        displayReference,
        operationType: input.operationType,
        status: 'PENDING_CONFIRMATION',
        agentId: input.agentId,
        agentReference: input.agentReference,
        customerCustomerId: customerInfo.customerId,
        customerAccountId: customerInfo.accountId,
        customerMaskedReference: customerInfo.maskedReference,
        customerPublicReference: input.customerReference,
        agentAccountId: input.agentId, // We use agentId as agentAccountId conceptually for internal Ledger operations
        currency: input.currency,
        amountMinor: amount,
        intentTokenHash,
        idempotencyKeyHash: tempIdempotencyHash,
        requestHash: sha256('pending'),
        correlationId,
        expiresAt,
        events: {
          create: {
            eventType: 'OPERATION_CREATED',
            nextStatus: 'PENDING_CONFIRMATION',
            occurredAt: new Date(),
          },
        },
      },
    });

    return {
      operationId: operation.id,
      operationType: operation.operationType,
      customerMaskedReference: operation.customerMaskedReference,
      agentReference: operation.agentReference,
      amount: {
        currency: operation.currency,
        minorUnits: operation.amountMinor.toString(),
      },
      intentToken,
      expiresAt: operation.expiresAt.toISOString(),
    };
  }

  /**
   * Confirm an agent cash operation.
   */
  async confirm(
    input: {
      agentId: string;
      intentToken: string;
      idempotencyKey: string;
    },
    correlationId: string,
  ) {
    const intentTokenHash = sha256(input.intentToken);
    const keyHash = sha256(input.idempotencyKey);

    const result = await this.prisma.client.$transaction(async (tx) => {
      // Check idempotency
      const existing = await tx.agentCashOperation.findFirst({
        where: {
          agentId: input.agentId,
          idempotencyKeyHash: keyHash,
        },
      });

      if (existing) {
        const requestHash = canonicalHash({
          agentId: input.agentId,
          intentTokenHash,
        });
        if (existing.requestHash !== requestHash)
          throw new PaymentsError('IDEMPOTENCY_CONFLICT');
        return { operation: existing, replayed: true };
      }

      // Find operation by intent token hash
      const op = await tx.agentCashOperation.findUnique({
        where: { intentTokenHash },
      });

      if (!op) {
        throw new PaymentsError(
          'INVALID_REQUEST',
          'Operation not found or expired.',
          HttpStatus.NOT_FOUND,
        );
      }

      if (op.status !== 'PENDING_CONFIRMATION') {
        throw new PaymentsError(
          'INVALID_REQUEST',
          'Operation already processed.',
          HttpStatus.CONFLICT,
        );
      }

      if (new Date(op.expiresAt) <= new Date()) {
        throw new PaymentsError(
          'INTENT_EXPIRED',
          'Operation has expired.',
          HttpStatus.GONE,
        );
      }

      const requestHash = canonicalHash({
        agentId: input.agentId,
        intentTokenHash,
      });

      const updated = await tx.agentCashOperation.update({
        where: { id: op.id },
        data: {
          status: 'PROCESSING',
          idempotencyKeyHash: keyHash,
          requestHash,
          confirmedAt: new Date(),
        },
      });

      await tx.agentCashEvent.create({
        data: {
          operationId: op.id,
          eventType: 'CUSTOMER_CONFIRMED',
          previousStatus: 'PENDING_CONFIRMATION',
          nextStatus: 'PROCESSING',
          occurredAt: new Date(),
        },
      });

      return { operation: updated, replayed: false };
    });

    if (result.replayed || result.operation.status !== 'PROCESSING') {
      return this.formatOperation(result.operation);
    }

    return this.formatOperation(
      await this.settle(result.operation, correlationId),
    );
  }

  async status(agentId: string, operationId: string) {
    const op = await this.prisma.client.agentCashOperation.findFirst({
      where: { id: operationId, agentId },
    });

    if (!op)
      throw new PaymentsError(
        'TRANSFER_NOT_FOUND',
        'Operation not found.',
        HttpStatus.NOT_FOUND,
      );

    return this.formatOperation(op);
  }

  async limits(agentReference: string) {
    // Dummy limits for now, could be dynamic
    return {
      agentReference,
      currency: 'LKR',
      minTransactionMinor: this.config.minTransferMinor.toString(),
      maxTransactionMinor: this.config.maxTransferMinor.toString(),
      dailyCashInLimitMinor: this.config.dailyOutgoingLimitMinor.toString(),
      dailyCashOutLimitMinor: this.config.dailyOutgoingLimitMinor.toString(),
      dailyCashInUsedMinor: '0',
      dailyCashOutUsedMinor: '0',
      floatBalanceMinor: '10000000', // 100,000 LKR
      floatLimitMinor: '50000000',
    };
  }

  private async settle(
    op: {
      id: string;
      displayReference: string;
      operationType: string;
      agentAccountId: string;
      customerPublicReference: string;
      amountMinor: bigint;
      currency: string;
    },
    correlationId: string,
  ) {
    try {
      // Create ledger channel operation logic handled via LedgerClient's custom method or transfer method
      // We will add `channel-operations` endpoint to Ledger
      const path =
        op.operationType === 'AGENT_CASH_IN'
          ? '/internal/channel-operations/agent-cash-in'
          : '/internal/channel-operations/agent-cash-out';

      const ledgerResult = await this.ledger.transfer(
        {
          transferId: op.id,
          transferReference: op.displayReference,
          senderCustomerId: 'agent', // Not used strictly by ledger in this context if we use channel ops
          sourceAccountId: op.agentAccountId,
          recipientReference: op.customerPublicReference,
          amountMinor: op.amountMinor.toString(),
          currency: op.currency,
          idempotencyKey: `agent-cash:${op.id}`,
        } as any,
        correlationId,
      );
      // NOTE: Ledger will actually need a real endpoint for this to route correctly and use correct journal types

      const updated = await this.prisma.client.agentCashOperation.update({
        where: { id: op.id },
        data: {
          status: 'COMPLETED',
          ledgerJournalId: ledgerResult.journalId,
          completedAt: new Date(),
        },
      });

      await this.prisma.client.agentCashEvent.create({
        data: {
          operationId: op.id,
          eventType: 'COMPLETED',
          previousStatus: 'PROCESSING',
          nextStatus: 'COMPLETED',
          occurredAt: new Date(),
        },
      });

      return updated;
    } catch (error) {
      if (error instanceof LedgerCallError && error.status < 500) {
        const updated = await this.prisma.client.agentCashOperation.update({
          where: { id: op.id },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
          },
        });

        await this.prisma.client.agentCashEvent.create({
          data: {
            operationId: op.id,
            eventType: 'FAILED',
            previousStatus: 'PROCESSING',
            nextStatus: 'FAILED',
            occurredAt: new Date(),
          },
        });

        return updated;
      }
      return op as any;
    }
  }

  private formatOperation(op: {
    id: string;
    displayReference: string;
    operationType: string;
    status: string;
    customerMaskedReference: string;
    agentReference: string;
    currency: string;
    amountMinor: bigint | string | number;
    createdAt: Date;
    completedAt?: Date | null;
  }) {
    return {
      id: op.id,
      displayReference: op.displayReference,
      operationType: op.operationType,
      status: op.status,
      customerMaskedReference: op.customerMaskedReference,
      agentReference: op.agentReference,
      amount: { currency: op.currency, minorUnits: op.amountMinor.toString() },
      createdAt: op.createdAt.toISOString(),
      completedAt: op.completedAt?.toISOString() ?? null,
    };
  }

  private generateReference(): string {
    const value = crypto
      .randomBytes(12)
      .toString('hex')
      .toUpperCase();
    return `AEGIS-AGT-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
  }
}
