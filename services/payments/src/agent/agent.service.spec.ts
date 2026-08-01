/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/no-unused-vars, prettier/prettier */
import { HttpStatus } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PAYMENTS_CONFIG } from '../common/config/payments.config';
import { PaymentsError } from '../common/errors/payments.error';
import { PrismaService } from '../database/prisma.service';
import { LedgerCallError, LedgerClient } from '../transfers/ledger.client';
import { AgentService } from './agent.service';

describe('AgentService', () => {
  let service: AgentService;
  let prisma: PrismaService;
  let ledger: LedgerClient;

  const mockConfig = {
    minTransferMinor: 100n,
    maxTransferMinor: 5000000n,
    dailyOutgoingLimitMinor: 10000000n,
    intentTtlSeconds: 300,
  };

  const mockPrisma: any = {
    client: {
      agentCashOperation: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn(),
      },
      agentCashEvent: {
        create: jest.fn(),
      },
      $transaction: async (fn: any): Promise<any> => fn(mockPrisma.client),
    },
  };

  const mockLedger: any = {
    resolveAccountByReference: jest.fn(),
    transfer: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerClient, useValue: mockLedger },
        { provide: PAYMENTS_CONFIG, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<AgentService>(AgentService);
    prisma = module.get<PrismaService>(PrismaService);
    ledger = module.get<LedgerClient>(LedgerClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('preview', () => {
    it('creates an agent cash in operation successfully', async () => {
      mockLedger.resolveAccountByReference.mockResolvedValue({
        customerId: 'cust-1',
        accountId: 'acc-1',
        maskedReference: 'AEGIS-****-****-0000',
      });

      mockPrisma.client.agentCashOperation.aggregate.mockResolvedValue({
        _sum: { amountMinor: 500n },
      });

      mockPrisma.client.agentCashOperation.create.mockResolvedValue({
        id: 'op-123',
        operationType: 'AGENT_CASH_IN',
        customerMaskedReference: 'AEGIS-****-****-0000',
        agentReference: 'AEGIS-AGT-1234',
        currency: 'LKR',
        amountMinor: 1000n,
        expiresAt: new Date(Date.now() + 300000),
      });

      const result = await service.preview(
        {
          agentId: 'agt-1',
          agentReference: 'AEGIS-AGT-1234',
          customerReference: 'AEGIS-0000-0000-0000',
          amountMinor: '1000',
          currency: 'LKR',
          operationType: 'AGENT_CASH_IN',
        },
        'corr-123',
      );

      expect(result.operationId).toBe('op-123');
      expect(result.operationType).toBe('AGENT_CASH_IN');
      expect(result.intentToken).toBeDefined();
    });

    it('rejects if customer account is not found', async () => {
      mockLedger.resolveAccountByReference.mockRejectedValue(
        new LedgerCallError(HttpStatus.NOT_FOUND),
      );

      await expect(
        service.preview(
          {
            agentId: 'agt-1',
            agentReference: 'AEGIS-AGT-1234',
            customerReference: 'INVALID-REF',
            amountMinor: '1000',
            currency: 'LKR',
            operationType: 'AGENT_CASH_IN',
          },
          'corr-123',
        ),
      ).rejects.toThrow('Customer account not found.');
    });
  });

  describe('confirm', () => {
    it('confirms and settles a cash-in operation', async () => {
      mockPrisma.client.agentCashOperation.findFirst.mockResolvedValue(null);
      mockPrisma.client.agentCashOperation.findUnique.mockResolvedValue({
        id: 'op-123',
        status: 'PENDING_CONFIRMATION',
        expiresAt: new Date(Date.now() + 300000),
        agentId: 'agt-1',
      });

      mockPrisma.client.agentCashOperation.update.mockResolvedValueOnce({
        id: 'op-123',
        displayReference: 'AEGIS-AGT-1234-5678-9012',
        status: 'PROCESSING',
        operationType: 'AGENT_CASH_IN',
        customerMaskedReference: 'AEGIS-****-****-0000',
        agentReference: 'AEGIS-AGT-1234',
        agentAccountId: 'agt-1',
        customerPublicReference: 'AEGIS-0000-0000-0000',
        currency: 'LKR',
        amountMinor: 1000n,
        createdAt: new Date(),
      });

      mockLedger.transfer.mockResolvedValue({
        journalId: 'journal-123',
      });

      mockPrisma.client.agentCashOperation.update.mockResolvedValueOnce({
        id: 'op-123',
        displayReference: 'AEGIS-AGT-1234-5678-9012',
        status: 'COMPLETED',
        operationType: 'AGENT_CASH_IN',
        customerMaskedReference: 'AEGIS-****-****-0000',
        agentReference: 'AEGIS-AGT-1234',
        currency: 'LKR',
        amountMinor: 1000n,
        createdAt: new Date(),
        completedAt: new Date(),
      });

      const result = await service.confirm(
        {
          agentId: 'agt-1',
          intentToken: 'token-123',
          idempotencyKey: 'key-123',
        },
        'corr-123',
      );

      expect(result.status).toBe('COMPLETED');
      expect(mockLedger.transfer).toHaveBeenCalled();
    });
  });
});
