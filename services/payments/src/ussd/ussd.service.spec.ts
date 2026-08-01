import { Test, TestingModule } from '@nestjs/testing';
import { UssdService } from './ussd.service';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { LedgerClient } from '../transfers/ledger.client';

describe('UssdService', () => {
  let service: UssdService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UssdService,
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: RedisService,
          useValue: {
            key: jest.fn((prefix: string, id: string) => `${prefix}:${id}`),
            get: jest.fn(),
            set: jest.fn(),
            expire: jest.fn(),
            del: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: LedgerClient,
          useValue: {
            resolveAccountByReference: jest
              .fn()
              .mockResolvedValue({ accountId: 'account-1' }),
            transfer: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = module.get<UssdService>(UssdService);
  });

  it('should handle USSD flow correctly', async () => {
    const sessionId = 'session-1';
    const correlationId = 'corr-1';

    const redisMap = new Map<string, string>();
    const redis = service['redis'] as unknown as {
      key: jest.Mock;
      get: jest.Mock;
      set: jest.Mock;
      delete: jest.Mock;
    };
    redis.key.mockImplementation(
      (prefix: string, id: string) => `${prefix}:${id}`,
    );
    redis.get.mockImplementation((key: string) => redisMap.get(key) || null);
    redis.set.mockImplementation((key: string, val: string) => {
      redisMap.set(key, val);
    });
    redis.delete.mockImplementation((key: string) => {
      redisMap.delete(key);
    });

    // 1. Welcome
    let res = await service.handleWebhook(
      { sessionId, msisdn: '+94770000000', input: '*123#', type: 'request' },
      correlationId,
    );
    expect(res.message).toContain('Welcome');
    expect(res.type).toBe('response');

    // 2. Select Send Money
    res = await service.handleWebhook(
      { sessionId, msisdn: '+94770000000', input: '2', type: 'response' },
      correlationId,
    );
    expect(res.message).toContain('Enter recipient account');

    // 3. Enter recipient
    res = await service.handleWebhook(
      {
        sessionId,
        msisdn: '+94770000000',
        input: 'AEGIS-1234',
        type: 'response',
      },
      correlationId,
    );
    expect(res.message).toContain('Enter amount in LKR');

    // 4. Enter amount
    res = await service.handleWebhook(
      { sessionId, msisdn: '+94770000000', input: '500', type: 'response' },
      correlationId,
    );
    expect(res.message).toContain('Send 500 LKR');

    // 5. Confirm
    res = await service.handleWebhook(
      { sessionId, msisdn: '+94770000000', input: '1', type: 'response' },
      correlationId,
    );
    expect(res.message).toContain('Enter your 6-digit PIN');

    // 6. Enter PIN
    res = await service.handleWebhook(
      { sessionId, msisdn: '+94770000000', input: '123456', type: 'response' },
      correlationId,
    );
    expect(res.message).toContain('Transfer successful');
    expect(res.type).toBe('release');

    const ledger = service['ledger'] as unknown as { transfer: jest.Mock };
    expect(ledger.transfer).toHaveBeenCalled();
  });
});
