import type { IdentityConfig } from '../../common/config/identity.config';
import type { PrismaService } from '../../database/prisma.service';
import { AuthEventService } from './auth-event.service';

describe('Identity Risk event emission', () => {
  const config = {
    riskServiceUrl: 'http://127.0.0.1:4105',
    riskIdentitySourceToken: 'identity-source-token',
    riskTimeoutMs: 500,
  } as IdentityConfig;

  afterEach(() => jest.restoreAllMocks());

  it('emits failed PIN step-up as a safe opaque event', async () => {
    const create = jest
      .fn()
      .mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' });
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 202 }));
    const service = new AuthEventService(
      { client: { authEvent: { create } } } as unknown as PrismaService,
      config,
    );
    await service.record({
      userId: '22222222-2222-4222-8222-222222222222',
      eventType: 'TRANSFER_STEP_UP',
      outcome: 'FAILURE',
      correlationId: '33333333-3333-4333-8333-333333333333',
      userAgent: 'browser fixture',
      metadata: { attempt: 2 },
    });
    const requestBody = (fetchMock.mock.calls[0]?.[1] as RequestInit).body;
    expect(typeof requestBody).toBe('string');
    const payload = typeof requestBody === 'string' ? requestBody : '';
    expect(payload).toContain('PIN_FAILURE');
    expect(payload).not.toContain('browser fixture');
    expect(payload).not.toContain('identity-source-token');
    expect(payload).not.toContain('654321');
  });

  it('keeps authentication audit persistence available when Risk telemetry fails', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('risk unavailable'));
    const create = jest
      .fn()
      .mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' });
    await expect(
      new AuthEventService(
        { client: { authEvent: { create } } } as unknown as PrismaService,
        config,
      ).record({
        eventType: 'LOGIN',
        outcome: 'SUCCESS',
        correlationId: '33333333-3333-4333-8333-333333333333',
      }),
    ).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('maps an automated session control to a revocation event', async () => {
    const create = jest
      .fn()
      .mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' });
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 202 }));
    await new AuthEventService(
      { client: { authEvent: { create } } } as unknown as PrismaService,
      config,
    ).record({
      userId: '22222222-2222-4222-8222-222222222222',
      eventType: 'SESSION_CONTROL',
      outcome: 'ACCEPTED',
      correlationId: '33333333-3333-4333-8333-333333333333',
    });
    const requestBody = (fetchMock.mock.calls[0]?.[1] as RequestInit).body;
    expect(typeof requestBody).toBe('string');
    expect(typeof requestBody === 'string' ? requestBody : '').toContain(
      'SESSION_REVOKED',
    );
  });
});
