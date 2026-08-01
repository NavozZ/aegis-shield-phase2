/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/no-unused-vars, prettier/prettier */
import { HttpStatus } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PAYMENTS_CONFIG } from '../common/config/payments.config';
import { PaymentsError } from '../common/errors/payments.error';
import { PrismaService } from '../database/prisma.service';
import { LedgerCallError, LedgerClient } from '../transfers/ledger.client';
import { QrService } from './qr.service';
import {
  decodeQrPayload,
  encodeQrPayload,
  generateQrNonce,
  sha256,
  signQrPayload,
  QR_PROTOCOL_VERSION,
} from './qr-crypto';

describe('QrService', () => {
  let service: QrService;
  let prisma: PrismaService;
  let ledger: LedgerClient;

  const mockConfig = {
    qrSigningKey: 'test-signing-key-12345',
    qrDynamicTtlSeconds: 300,
    qrStaticTtlHours: 8760,
  };

  const mockPrisma: any = {
    client: {
      qrPaymentRequest: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      qrRedemption: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      qrPaymentEvent: {
        create: jest.fn(),
      },
      $transaction: async (fn: any): Promise<any> => fn(mockPrisma.client),
    },
  };

  const mockLedger: any = {
    transfer: jest.fn(),
    getAccountDetail: jest.fn().mockResolvedValue({
      accountId: 'acc-1',
      maskedReference: 'AEGIS-****-****-0000',
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QrService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerClient, useValue: mockLedger },
        { provide: PAYMENTS_CONFIG, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<QrService>(QrService);
    prisma = module.get<PrismaService>(PrismaService);
    ledger = module.get<LedgerClient>(LedgerClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('issue', () => {
    it('creates a dynamic QR code successfully', async () => {
      mockLedger.getAccountDetail.mockResolvedValueOnce({
        maskedReference: 'AEGIS-****-****-0000',
        receivingReference: 'AEGIS-0000-0000-0000',
      });

      mockPrisma.client.qrPaymentRequest.create.mockResolvedValue({
        id: 'qr-123',
        type: 'DYNAMIC',
        expiresAt: new Date(Date.now() + 300000),
      });

      const result = await service.issue({
        customerId: 'cust-1',
        accountId: 'acc-1',
        type: 'DYNAMIC',
        amountMinor: '10000',
        currency: 'LKR',
      });

      expect(result.qrId).toBe('qr-123');
      expect(result.type).toBe('DYNAMIC');
      expect(result.payload).toBeDefined();

      const decoded = decodeQrPayload(result.payload);
      expect(decoded).not.toBeNull();
      expect(decoded?.amountMinor).toBe('10000');
      expect(decoded?.recipientRef).toBe('AEGIS-0000-0000-0000');
    });

    it('throws ACCOUNT_NOT_FOUND if ledger cannot find account', async () => {
      mockLedger.getAccountDetail.mockRejectedValueOnce(
        new LedgerCallError(HttpStatus.NOT_FOUND),
      );

      await expect(
        service.issue({
          customerId: 'cust-1',
          accountId: 'acc-1',
          type: 'STATIC',
          currency: 'LKR',
        }),
      ).rejects.toThrow('Account not found.');
    });
  });

  describe('preview', () => {
    it('validates and previews a QR code successfully', async () => {
      const payloadData = {
        version: QR_PROTOCOL_VERSION,
        recipientRef: 'AEGIS-0000-0000-0000',
        currency: 'LKR',
        amountMinor: '10000',
        nonce: generateQrNonce(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        type: 'DYNAMIC' as const,
        keyId: 'aegis-qr-v1',
      };

      const signed = signQrPayload(payloadData, mockConfig.qrSigningKey);
      const encoded = encodeQrPayload(signed);

      mockPrisma.client.qrPaymentRequest.findUnique.mockResolvedValue({
        id: 'qr-123',
        recipientMaskedReference: 'AEGIS-****-****-0000',
        amountMinor: 10000n,
        currency: 'LKR',
        purpose: null,
        type: 'DYNAMIC',
        expiresAt: new Date(payloadData.expiresAt),
        status: 'ACTIVE',
        recipientCustomerId: 'cust-99', // not the sender
      });

      const result = await service.preview({
        payload: encoded,
        senderCustomerId: 'cust-1',
        sourceAccountId: 'acc-1',
      });

      expect(result.qrId).toBe('qr-123');
      expect(result.recipientMaskedReference).toBe('AEGIS-****-****-0000');
      expect(result.amount).toEqual({ currency: 'LKR', minorUnits: '10000' });
      expect(result.intentToken).toBeDefined();
    });

    it('rejects self-transfer', async () => {
      const payloadData = {
        version: QR_PROTOCOL_VERSION,
        recipientRef: 'AEGIS-0000-0000-0000',
        currency: 'LKR',
        nonce: generateQrNonce(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        type: 'STATIC' as const,
        keyId: 'aegis-qr-v1',
      };

      const signed = signQrPayload(payloadData, mockConfig.qrSigningKey);
      const encoded = encodeQrPayload(signed);

      mockPrisma.client.qrPaymentRequest.findUnique.mockResolvedValue({
        id: 'qr-123',
        recipientCustomerId: 'cust-1', // same as sender
        status: 'ACTIVE',
        type: 'STATIC',
        expiresAt: new Date(payloadData.expiresAt),
      });

      await expect(
        service.preview({
          payload: encoded,
          senderCustomerId: 'cust-1', // same as recipient
          sourceAccountId: 'acc-1',
        }),
      ).rejects.toThrow('You cannot pay yourself.');
    });

    it('rejects expired QR payload', async () => {
      const payloadData = {
        version: QR_PROTOCOL_VERSION,
        recipientRef: 'AEGIS-0000-0000-0000',
        currency: 'LKR',
        nonce: generateQrNonce(),
        expiresAt: new Date(Date.now() - 300000).toISOString(), // expired
        type: 'STATIC' as const,
        keyId: 'aegis-qr-v1',
      };

      const signed = signQrPayload(payloadData, mockConfig.qrSigningKey);
      const encoded = encodeQrPayload(signed);

      await expect(
        service.preview({
          payload: encoded,
          senderCustomerId: 'cust-1',
          sourceAccountId: 'acc-1',
        }),
      ).rejects.toThrow('This QR code has expired.');
    });

    it('rejects tampered signature', async () => {
      const payloadData = {
        version: QR_PROTOCOL_VERSION,
        recipientRef: 'AEGIS-0000-0000-0000',
        currency: 'LKR',
        nonce: generateQrNonce(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        type: 'STATIC' as const,
        keyId: 'aegis-qr-v1',
      };

      const signed = signQrPayload(payloadData, mockConfig.qrSigningKey);
      // Tamper with data after signing
      signed.amountMinor = '9999999';
      const encoded = encodeQrPayload(signed);

      await expect(
        service.preview({
          payload: encoded,
          senderCustomerId: 'cust-1',
          sourceAccountId: 'acc-1',
        }),
      ).rejects.toThrow('QR signature verification failed.');
    });
  });
});
