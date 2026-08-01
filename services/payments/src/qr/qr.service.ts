/* eslint-disable */
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  PAYMENTS_CONFIG,
  type PaymentsConfig,
} from '../common/config/payments.config';
import { PaymentsError } from '../common/errors/payments.error';
import { canonicalHash, newIntentToken } from '../common/security/security';
import { PrismaService } from '../database/prisma.service';
import { LedgerClient, LedgerCallError } from '../transfers/ledger.client';
import {
  decodeQrPayload,
  encodeQrPayload,
  generateQrNonce,
  newQrPaymentReference,
  sha256,
  signQrPayload,
  verifyQrSignature,
  QR_PROTOCOL_VERSION,
} from './qr-crypto';

@Injectable()
export class QrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerClient,
    @Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig,
  ) {}

  /**
   * Issue a QR code (static or dynamic).
   */
  async issue(input: {
    customerId: string;
    accountId: string;
    type: 'STATIC' | 'DYNAMIC';
    amountMinor?: string;
    currency: string;
    purpose?: string;
  }): Promise<{
    qrId: string;
    payload: string;
    type: 'STATIC' | 'DYNAMIC';
    expiresAt: string;
  }> {
    let accountDetail;
    try {
      accountDetail = await this.ledger.getAccountDetail(
        input.accountId,
        input.customerId,
        crypto.randomUUID(),
      );
    } catch (error) {
      if (
        error instanceof LedgerCallError &&
        (error.status as unknown as number) === HttpStatus.NOT_FOUND
      ) {
        throw new PaymentsError(
          'ACCOUNT_NOT_FOUND',
          'Account not found.',
          HttpStatus.NOT_FOUND,
        );
      }
      throw error;
    }

    const maskedRef = accountDetail.maskedReference;
    const publicRef = accountDetail.receivingReference;

    const nonce = generateQrNonce();
    const ttlMs =
      input.type === 'DYNAMIC'
        ? this.config.qrDynamicTtlSeconds * 1000
        : this.config.qrStaticTtlHours * 3600 * 1000;
    const expiresAt = new Date(Date.now() + ttlMs);

    const payloadData = {
      version: QR_PROTOCOL_VERSION,
      recipientRef: publicRef,
      currency: input.currency,
      ...(input.amountMinor ? { amountMinor: input.amountMinor } : {}),
      nonce,
      expiresAt: expiresAt.toISOString(),
      type: input.type,
      ...(input.purpose ? { purpose: input.purpose } : {}),
      keyId: 'aegis-qr-v1',
    };

    const signedPayload = signQrPayload(payloadData, this.config.qrSigningKey);
    const encoded = encodeQrPayload(signedPayload);

    const qr = await this.prisma.client.qrPaymentRequest.create({
      data: {
        type: input.type,
        status: 'ACTIVE',
        recipientCustomerId: input.customerId,
        recipientAccountId: input.accountId,
        recipientMaskedReference: maskedRef,
        recipientPublicReference: publicRef,
        currency: input.currency,
        ...(input.amountMinor
          ? { amountMinor: BigInt(input.amountMinor) }
          : {}),
        ...(input.purpose ? { purpose: input.purpose } : {}),
        nonceHash: sha256(nonce),
        signatureHash: sha256(signedPayload.signature),
        protocolVersion: QR_PROTOCOL_VERSION,
        expiresAt,
        events: {
          create: {
            eventType: 'QR_ISSUED',
            nextStatus: 'ACTIVE',
            occurredAt: new Date(),
          },
        },
      },
    });

    return {
      qrId: qr.id,
      payload: encoded,
      type: input.type,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Preview a scanned QR payload — validate and return safe preview data.
   */
  async preview(input: {
    payload: string;
    senderCustomerId: string;
    sourceAccountId: string;
  }): Promise<{
    qrId: string;
    recipientMaskedReference: string;
    amount: { currency: string; minorUnits: string } | null;
    purpose: string | null;
    type: 'STATIC' | 'DYNAMIC';
    expiresAt: string;
    intentToken: string;
  }> {
    const decoded = decodeQrPayload(input.payload);
    if (!decoded)
      throw new PaymentsError(
        'QR_INVALID',
        'The QR code is malformed.',
        HttpStatus.BAD_REQUEST,
      );

    // Verify version
    if (decoded.version !== QR_PROTOCOL_VERSION)
      throw new PaymentsError(
        'QR_UNSUPPORTED_VERSION',
        'This QR version is not supported.',
        HttpStatus.BAD_REQUEST,
      );

    // Verify signature
    if (!verifyQrSignature(decoded, this.config.qrSigningKey))
      throw new PaymentsError(
        'QR_INVALID_SIGNATURE',
        'QR signature verification failed.',
        HttpStatus.BAD_REQUEST,
      );

    // Check expiry
    if (new Date(decoded.expiresAt) <= new Date())
      throw new PaymentsError(
        'QR_EXPIRED',
        'This QR code has expired.',
        HttpStatus.GONE,
      );

    // Check currency
    if (decoded.currency !== 'LKR')
      throw new PaymentsError(
        'QR_INVALID_CURRENCY',
        'Currency is not supported.',
        HttpStatus.BAD_REQUEST,
      );

    // Validate amount if present
    if (decoded.amountMinor !== undefined) {
      const amount = BigInt(decoded.amountMinor);
      if (amount <= 0n)
        throw new PaymentsError(
          'QR_INVALID_AMOUNT',
          'Amount must be positive.',
          HttpStatus.BAD_REQUEST,
        );
    }

    // Find QR record by nonce hash
    const nonceHash = sha256(decoded.nonce);
    const qrRecord = await this.prisma.client.qrPaymentRequest.findUnique({
      where: { nonceHash },
    });

    if (!qrRecord)
      throw new PaymentsError(
        'QR_INVALID',
        'QR code not found.',
        HttpStatus.NOT_FOUND,
      );

    // Check if already redeemed (dynamic single-use)
    if (qrRecord.type === 'DYNAMIC' && qrRecord.status === 'REDEEMED')
      throw new PaymentsError(
        'QR_ALREADY_REDEEMED',
        'This QR code has already been used.',
        HttpStatus.CONFLICT,
      );

    if (qrRecord.status === 'EXPIRED' || qrRecord.status === 'CANCELLED')
      throw new PaymentsError(
        'QR_EXPIRED',
        'This QR code is no longer valid.',
        HttpStatus.GONE,
      );

    // Prevent self-payment
    if (qrRecord.recipientCustomerId === input.senderCustomerId)
      throw new PaymentsError(
        'SELF_TRANSFER',
        'You cannot pay yourself.',
        HttpStatus.CONFLICT,
      );

    // Generate intent token for confirmation
    const intentToken = newIntentToken();
    const intentTokenHash = sha256(intentToken);

    // Get sender account details to resolve account ID
    const senderAccountId = input.sourceAccountId;
    let senderMaskedRef = 'UNKNOWN';
    try {
      const accountDetail = await this.ledger.getAccountDetail(
        input.sourceAccountId,
        input.senderCustomerId,
        crypto.randomUUID(),
      );
      senderMaskedRef = accountDetail.maskedReference;
    } catch {
      throw new PaymentsError(
        'ACCOUNT_NOT_FOUND',
        'Sender account not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Record the scan event and create redemption intent
    await this.prisma.client.$transaction(async (tx) => {
      await tx.qrPaymentEvent.create({
        data: {
          qrPaymentRequestId: qrRecord.id,
          eventType: 'QR_SCANNED',
          occurredAt: new Date(),
        },
      });

      await tx.qrRedemption.create({
        data: {
          qrPaymentRequestId: qrRecord.id,
          displayReference: newQrPaymentReference(),
          senderCustomerId: input.senderCustomerId,
          senderAccountId,
          senderMaskedReference: senderMaskedRef,
          recipientCustomerId: qrRecord.recipientCustomerId,
          recipientAccountId: qrRecord.recipientAccountId,
          recipientMaskedReference: qrRecord.recipientMaskedReference,
          currency: qrRecord.currency,
          amountMinor:
            qrRecord.amountMinor ?? BigInt(decoded.amountMinor || '0'),
          status: 'PROCESSING',
          intentTokenHash,
          idempotencyKeyHash: sha256(`temp-${intentToken}`),
          requestHash: sha256('pending'),
          correlationId: crypto.randomUUID(),
        },
      });
    });

    return {
      qrId: qrRecord.id,
      recipientMaskedReference: qrRecord.recipientMaskedReference,
      amount: qrRecord.amountMinor
        ? {
            currency: qrRecord.currency,
            minorUnits: qrRecord.amountMinor.toString(),
          }
        : null,
      purpose: qrRecord.purpose,
      type: qrRecord.type,
      expiresAt: qrRecord.expiresAt.toISOString(),
      intentToken,
    };
  }

  /**
   * Confirm a QR payment after PIN step-up.
   */
  async confirm(
    input: {
      senderCustomerId: string;
      intentToken: string;
      idempotencyKey: string;
      amountMinor?: string;
    },
    correlationId: string,
  ): Promise<{
    id: string;
    displayReference: string;
    status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
    senderMaskedReference: string;
    recipientMaskedReference: string;
    amount: { currency: string; minorUnits: string };
    senderBalanceAfter: { currency: string; minorUnits: string } | null;
    createdAt: string;
    completedAt: string | null;
  }> {
    const intentTokenHash = sha256(input.intentToken);
    const keyHash = sha256(input.idempotencyKey);

    // Find the QR redemption by intent token (we store intent token hash on creation)
    // First, find the QR record that was previewed with this intent token
    // We need to store the intent token hash during preview
    // For now, we look up by the stored intent token hash

    const result = await this.prisma.client.$transaction(async (tx) => {
      // Check idempotency
      const existing = await tx.qrRedemption.findFirst({
        where: {
          senderCustomerId: input.senderCustomerId,
          idempotencyKeyHash: keyHash,
        },
      });

      if (existing) {
        const requestHash = canonicalHash({
          senderCustomerId: input.senderCustomerId,
          intentTokenHash,
        });
        if (existing.requestHash !== requestHash)
          throw new PaymentsError('IDEMPOTENCY_CONFLICT');
        return { redemption: existing, replayed: true };
      }

      // Find QR by intent token hash
      const redemption = await tx.qrRedemption.findUnique({
        where: { intentTokenHash },
        include: { qrPaymentRequest: true },
      });
      if (!redemption) {
        throw new PaymentsError(
          'QR_INVALID',
          'Invalid or expired session.',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (redemption.status !== 'PROCESSING') {
        throw new PaymentsError(
          'QR_ALREADY_REDEEMED',
          'This QR code has already been processed.',
          HttpStatus.CONFLICT,
        );
      }

      // Check expiry of the underlying QR
      if (
        redemption.qrPaymentRequest.expiresAt <= new Date() ||
        redemption.qrPaymentRequest.status === 'EXPIRED'
      ) {
        throw new PaymentsError(
          'QR_EXPIRED',
          'This QR code has expired.',
          HttpStatus.GONE,
        );
      }

      // Update idempotency hash for this execution
      const updated = await tx.qrRedemption.update({
        where: { id: redemption.id },
        data: {
          idempotencyKeyHash: keyHash,
          requestHash: canonicalHash({
            senderCustomerId: input.senderCustomerId,
            intentTokenHash,
          }),
        },
        include: { qrPaymentRequest: true },
      });

      return { redemption: updated, replayed: false };
    });

    if (result.replayed) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return this.formatRedemption(result.redemption as any);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return this.formatRedemption(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      (await this.settle(result.redemption as any, correlationId)) as any,
    );
  }

  /**
   * Get QR payment status.
   */
  async status(
    customerId: string,
    qrId: string,
  ): Promise<{
    id: string;
    displayReference: string;
    status: string;
    amount: { currency: string; minorUnits: string };
    createdAt: string;
    completedAt: string | null;
  }> {
    const redemption = await this.prisma.client.qrRedemption.findFirst({
      where: {
        qrPaymentRequestId: qrId,
        OR: [
          { senderCustomerId: customerId },
          { recipientCustomerId: customerId },
        ],
      },
    });

    if (!redemption) {
      throw new PaymentsError(
        'TRANSFER_NOT_FOUND',
        'QR payment not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      id: redemption.id,
      displayReference: redemption.displayReference,
      status: redemption.status,
      amount: {
        currency: redemption.currency,
        minorUnits: redemption.amountMinor.toString(),
      },
      createdAt: redemption.createdAt.toISOString(),
      completedAt: redemption.completedAt?.toISOString() ?? null,
    };
  }

  /**
   * Get QR payment receipt.
   */
  async receipt(customerId: string, qrId: string) {
    const redemption = await this.prisma.client.qrRedemption.findFirst({
      where: {
        qrPaymentRequestId: qrId,
        OR: [
          { senderCustomerId: customerId },
          { recipientCustomerId: customerId },
        ],
      },
      include: { qrPaymentRequest: true },
    });

    if (!redemption) {
      throw new PaymentsError(
        'TRANSFER_NOT_FOUND',
        'QR payment not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      id: redemption.id,
      displayReference: redemption.displayReference,
      receiptReference: `RCPT-${redemption.displayReference}`,
      status: redemption.status,
      senderMaskedReference: redemption.senderMaskedReference,
      recipientMaskedReference: redemption.recipientMaskedReference,
      amount: {
        currency: redemption.currency,
        minorUnits: redemption.amountMinor.toString(),
      },
      senderBalanceAfter: redemption.senderBalanceAfterMinor
        ? {
            currency: redemption.currency,
            minorUnits: redemption.senderBalanceAfterMinor.toString(),
          }
        : null,
      purpose: redemption.qrPaymentRequest.purpose ?? null,
      createdAt: redemption.createdAt.toISOString(),
      completedAt: redemption.completedAt?.toISOString() ?? null,
    };
  }

  private async settle(
    redemption: {
      id: string;
      displayReference: string;
      senderCustomerId: string;
      senderAccountId: string;
      amountMinor: bigint;
      currency: string;
      correlationId: string;
      qrPaymentRequestId: string;
      qrPaymentRequest: { recipientPublicReference: string };
    },
    correlationId: string,
  ) {
    try {
      const result = await this.ledger.transfer(
        {
          transferId: redemption.id,
          transferReference: redemption.displayReference,
          senderCustomerId: redemption.senderCustomerId,
          sourceAccountId: redemption.senderAccountId,
          recipientReference:
            redemption.qrPaymentRequest.recipientPublicReference,
          amountMinor: redemption.amountMinor.toString(),
          currency: redemption.currency,
          idempotencyKey: `qr-pay:${redemption.id}`,
        },
        correlationId,
      );

      const updated = await this.prisma.client.qrRedemption.update({
        where: { id: redemption.id },
        data: {
          status: 'COMPLETED',
          ledgerJournalId: result.journalId,
          senderBalanceAfterMinor: BigInt(result.senderBalanceAfter.minorUnits),
          recipientBalanceAfterMinor: BigInt(
            result.recipientBalanceAfter.minorUnits,
          ),
          completedAt: new Date(),
          nextAttemptAt: null,
        },
      });

      // Mark QR as redeemed (dynamic)
      await this.prisma.client.qrPaymentRequest.update({
        where: { id: redemption.qrPaymentRequestId },
        data: {
          status: 'REDEEMED',
          redeemedAt: new Date(),
        },
      });

      await this.prisma.client.qrPaymentEvent.create({
        data: {
          qrPaymentRequestId: redemption.qrPaymentRequestId,
          eventType: 'COMPLETED',
          previousStatus: 'PROCESSING',
          nextStatus: 'COMPLETED',
          occurredAt: new Date(),
        },
      });

      return updated;
    } catch (error) {
      if (error instanceof LedgerCallError && error.status < 500) {
        const updated = await this.prisma.client.qrRedemption.update({
          where: { id: redemption.id },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            nextAttemptAt: null,
          },
        });

        await this.prisma.client.qrPaymentEvent.create({
          data: {
            qrPaymentRequestId: redemption.qrPaymentRequestId,
            eventType: 'FAILED',
            previousStatus: 'PROCESSING',
            nextStatus: 'FAILED',
            safeCode: error.code ?? 'UNKNOWN',
            occurredAt: new Date(),
          },
        });

        return updated;
      }
      return redemption;
    }
  }

  private formatRedemption(redemption: {
    id: string;
    displayReference: string;
    status: string;
    senderMaskedReference: string;
    recipientMaskedReference: string;
    currency: string;
    amountMinor: bigint;
    senderBalanceAfterMinor: bigint | null;
    createdAt: Date;
    completedAt: Date | null;
  }) {
    return {
      id: redemption.id,
      displayReference: redemption.displayReference,
      status: redemption.status as 'PROCESSING' | 'COMPLETED' | 'FAILED',
      senderMaskedReference: redemption.senderMaskedReference,
      recipientMaskedReference: redemption.recipientMaskedReference,
      amount: {
        currency: redemption.currency,
        minorUnits: redemption.amountMinor.toString(),
      },
      senderBalanceAfter: redemption.senderBalanceAfterMinor
        ? {
            currency: redemption.currency,
            minorUnits: redemption.senderBalanceAfterMinor.toString(),
          }
        : null,
      createdAt: redemption.createdAt.toISOString(),
      completedAt: redemption.completedAt?.toISOString() ?? null,
    };
  }
}
