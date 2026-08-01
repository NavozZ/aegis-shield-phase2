import { randomUUID } from 'node:crypto';
import type { PaymentsConfig } from '../common/config/payments.config';
import { PaymentsError } from '../common/errors/payments.error';
import { PaymentsRiskClient } from './risk.client';
const config = {
  riskServiceUrl: 'http://127.0.0.1:4105',
  riskInternalToken: 'test-risk-token',
  riskPaymentsSourceToken: 'test-source-token',
  riskTimeoutMs: 500,
} as PaymentsConfig;
const input = {
  operation: 'TRANSFER_CONFIRMATION' as const,
  subjectId: 'subject:payments:test',
  accountId: randomUUID(),
  recipientId: 'recipient:opaque:test',
  amountMinor: '10000',
  currency: 'LKR',
  stepUpVerified: true,
  correlationId: randomUUID(),
};
describe('Payments Risk enforcement', () => {
  afterEach(() => jest.restoreAllMocks());
  it('fails closed without evaluating when an active hold exists', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          allowed: false,
          decision: 'HOLD_FOR_REVIEW',
          reasonCodes: ['ACTIVE_HOLD'],
          requiresStepUp: false,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(
      new PaymentsRiskClient(config).enforce(input),
    ).rejects.toMatchObject<Partial<PaymentsError>>({
      code: 'SECURITY_CONTROL_ACTIVE',
      status: 403,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('fails closed when Risk is unavailable', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('unavailable'));
    await expect(
      new PaymentsRiskClient(config).enforce(input),
    ).rejects.toMatchObject<Partial<PaymentsError>>({
      code: 'RISK_UNAVAILABLE',
      status: 503,
    });
  });
  it('accepts only a server-returned allow decision and never sends a caller score', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            allowed: true,
            decision: 'ALLOW',
            reasonCodes: [],
            requiresStepUp: false,
            expiresAt: null,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            assessmentId: randomUUID(),
            score: 0,
            band: 'LOW',
            decision: 'ALLOW',
            triggeredRules: [],
            reasonCodes: [],
            controlRecommendation: null,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            ruleSetVersion: 'risk-rules-2026-08-v1',
            publicExplanation: 'No additional verification is required.',
          }),
          { status: 200 },
        ),
      );
    await expect(
      new PaymentsRiskClient(config).enforce(input),
    ).resolves.toMatchObject({ decision: 'ALLOW' });
    const requestBody = (fetchMock.mock.calls[1]?.[1] as RequestInit).body;
    expect(typeof requestBody).toBe('string');
    const evaluation = JSON.parse(
      typeof requestBody === 'string' ? requestBody : '',
    ) as Record<string, unknown>;
    expect(evaluation).not.toHaveProperty('score');
    expect(evaluation).not.toHaveProperty('decision');
  });
});
