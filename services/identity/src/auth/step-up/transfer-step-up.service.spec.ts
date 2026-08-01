import { TransferStepUpService } from './transfer-step-up.service';

const userId = '11111111-1111-4111-8111-111111111111';
const context = { correlationId: '22222222-2222-4222-8222-222222222222' };

function build() {
  const sessions = { subject: jest.fn().mockResolvedValue(userId) };
  const pins = {
    verifyPin: jest.fn().mockResolvedValue(true),
    performDummyVerification: jest.fn(),
  };
  const prisma = {
    client: {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: userId,
          status: 'ACTIVE',
          pinCredential: { pinHash: 'hash' },
        }),
      },
    },
  };
  const redis = {
    key: jest.fn((...parts: string[]) => parts.join(':')),
    get: jest.fn().mockResolvedValue(null),
    incrementWithTtl: jest.fn().mockResolvedValue(1),
    set: jest.fn(),
    delete: jest.fn(),
  };
  const events = { record: jest.fn() };
  const config = {
    transferStepUpMaxAttempts: 2,
    transferStepUpLockSeconds: 300,
  };
  return {
    service: new TransferStepUpService(
      sessions as never,
      pins as never,
      prisma as never,
      redis as never,
      events as never,
      config as never,
    ),
    sessions,
    pins,
    prisma,
    redis,
    events,
  };
}
describe('TransferStepUpService', () => {
  it('verifies an active session PIN without extending the session', async () => {
    const { service, sessions, pins, events } = build();
    await expect(service.verify('session', '123456', context)).resolves.toEqual(
      { verified: true },
    );
    expect(sessions.subject).toHaveBeenCalledWith('session');
    expect(pins.verifyPin).toHaveBeenCalledWith('hash', '123456');
    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'TRANSFER_STEP_UP',
        outcome: 'SUCCESS',
      }),
    );
  });
  it('records a failed attempt without logging the raw PIN', async () => {
    const { service, pins, events } = build();
    pins.verifyPin.mockResolvedValue(false);
    await expect(
      service.verify('session', '654321', context),
    ).rejects.toMatchObject({ code: 'TRANSFER_STEP_UP_FAILED' });
    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'FAILURE' }),
    );
    expect(JSON.stringify(events.record.mock.calls)).not.toContain('654321');
  });
  it('locks a customer after the configured attempt limit', async () => {
    const { service, pins, redis, events } = build();
    pins.verifyPin.mockResolvedValue(false);
    redis.incrementWithTtl.mockResolvedValue(2);
    await expect(
      service.verify('session', '654321', context),
    ).rejects.toMatchObject({ code: 'TRANSFER_STEP_UP_FAILED' });
    expect(redis.set).toHaveBeenCalled();
    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'LOCKED' }),
    );
  });
  it('rejects an existing cooldown before verifying a PIN', async () => {
    const { service, pins, redis } = build();
    redis.get.mockResolvedValue('1');
    await expect(
      service.verify('session', '654321', context),
    ).rejects.toMatchObject({ code: 'TRANSFER_STEP_UP_LOCKED' });
    expect(pins.verifyPin).not.toHaveBeenCalled();
  });
});
