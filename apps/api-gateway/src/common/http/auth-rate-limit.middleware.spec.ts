import type { NextFunction, Response } from 'express';
import type { RiskClient } from '../../risk/risk.client';
import { AuthRateLimitMiddleware } from './auth-rate-limit.middleware';
import type { RequestContext } from './request-context';

/**
 * A `next` that is still a NextFunction to the middleware, but keeps its Jest
 * mock surface so a test can count how many requests were let through.
 */
function nextHarness(): NextFunction & jest.Mock {
  return jest.fn();
}

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
    const next = nextHarness();
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

  it('does not let session checks starve a later onboarding', () => {
    // The regression that broke the transfer browser journey: a browser
    // navigating protected pages issues a session check per render, which used
    // to drain the single shared authentication bucket. A subsequent onboarding
    // then received 429 and its OTP field never rendered.
    const risk = { emit: jest.fn() } as unknown as RiskClient;
    const middleware = new AuthRateLimitMiddleware(risk);
    const next = nextHarness();
    const { response, status } = responseHarness();

    for (let count = 0; count < 500; count += 1) {
      middleware.use(
        { ip: '127.0.0.1', path: '/api/v1/auth/session' } as RequestContext,
        response,
        next,
      );
    }
    const afterSessionFlood = next.mock.calls.length;

    middleware.use(
      {
        ip: '127.0.0.1',
        path: '/api/v1/auth/onboarding/request-otp',
      } as RequestContext,
      response,
      next,
    );

    expect(next).toHaveBeenCalledTimes(afterSessionFlood + 1);
    // The session flood was itself limited; only onboarding stayed available.
    expect(status).toHaveBeenCalledWith(429);
  });

  it('still enforces a limit inside a family, so abuse is not merely relocated', () => {
    const risk = { emit: jest.fn() } as unknown as RiskClient;
    const middleware = new AuthRateLimitMiddleware(risk);
    const next = nextHarness();
    const { response, status } = responseHarness();
    const request = {
      ip: '203.0.113.7',
      path: '/api/v1/auth/fallback/login',
      method: 'POST',
      correlationId: '11111111-1111-4111-8111-111111111111',
    } as RequestContext;

    for (let count = 0; count < 200; count += 1) {
      middleware.use(request, response, next);
    }
    // Sign-in is the strictest family: far fewer than 200 attempts get through.
    expect(next.mock.calls.length).toBeLessThan(60);
    expect(status).toHaveBeenCalledWith(429);
  });

  it('does not let a varying path segment mint fresh budget', () => {
    // Previously each invented sub-path was its own bucket with its own budget.
    const risk = { emit: jest.fn() } as unknown as RiskClient;
    const middleware = new AuthRateLimitMiddleware(risk);
    const next = nextHarness();
    const { response, status } = responseHarness();

    for (let count = 0; count < 200; count += 1) {
      middleware.use(
        {
          ip: '203.0.113.9',
          path: `/api/v1/auth/invented-${count}`,
          method: 'POST',
        } as RequestContext,
        response,
        next,
      );
    }
    expect(next.mock.calls.length).toBeLessThan(60);
    expect(status).toHaveBeenCalledWith(429);
  });

  it('keeps buckets separate per client address', () => {
    const risk = { emit: jest.fn() } as unknown as RiskClient;
    const middleware = new AuthRateLimitMiddleware(risk);
    const next = nextHarness();
    const { response } = responseHarness();

    for (const ip of ['198.51.100.1', '198.51.100.2']) {
      for (let count = 0; count < 40; count += 1) {
        middleware.use(
          { ip, path: '/api/v1/auth/onboarding/request-otp' } as RequestContext,
          response,
          next,
        );
      }
    }
    // Neither address consumed the other's budget.
    expect(next).toHaveBeenCalledTimes(80);
  });

  it('rejects and emits a safe event after a bucket exceeds its limit', () => {
    const emit = jest.fn().mockResolvedValue(undefined);
    const middleware = new AuthRateLimitMiddleware({
      emit,
    } as unknown as RiskClient);
    const next = nextHarness();
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
