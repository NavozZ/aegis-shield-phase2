import type { NextFunction, Response } from 'express';
import type { RiskClient } from '../../risk/risk.client';
import { AuthRateLimitMiddleware } from './auth-rate-limit.middleware';
import type { RequestContext } from './request-context';

function responseHarness() {
  const json = jest.fn<void, [unknown]>();
  const status = jest.fn(() => ({ json }));
  return {
    response: {
      setHeader: jest.fn(),
      status,
    } as unknown as Response,
    status,
    json,
  };
}

describe('AuthRateLimitMiddleware', () => {
  it('isolates security-operator traffic from customer route buckets', () => {
    const risk = { emit: jest.fn() } as unknown as RiskClient;
    const middleware = new AuthRateLimitMiddleware(risk);
    const next = jest.fn() as NextFunction;
    const { response } = responseHarness();
    for (const path of ['/api/v1/accounts/one', '/api/v1/security-ops/events'])
      for (let count = 0; count < 120; count += 1)
        middleware.use(
          { ip: '127.0.0.1', path } as RequestContext,
          response,
          next,
        );
    expect(next).toHaveBeenCalledTimes(240);
  });

  it('rejects and emits a safe event after a bucket exceeds its limit', () => {
    const emit = jest.fn().mockResolvedValue(undefined);
    const middleware = new AuthRateLimitMiddleware({
      emit,
    } as unknown as RiskClient);
    const next = jest.fn() as NextFunction;
    const { response, status, json } = responseHarness();
    const request = {
      ip: '127.0.0.1',
      path: '/api/v1/transfers/confirm',
      method: 'POST',
      correlationId: '11111111-1111-4111-8111-111111111111',
    } as RequestContext;
    for (let count = 0; count < 121; count += 1)
      middleware.use(request, response, next);
    expect(next).toHaveBeenCalledTimes(120);
    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledTimes(1);
    expect(json.mock.calls[0]?.[0]).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests.',
        correlationId: request.correlationId,
      },
    });
    expect(emit).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ eventType: 'RATE_LIMIT_VIOLATION' }),
    );
  });
});
