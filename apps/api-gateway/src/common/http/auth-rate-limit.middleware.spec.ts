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

  it('classifies from originalUrl, because Express strips the mount prefix', () => {
    // The middleware is applied with forRoutes('api/v1/auth/*'), and Express
    // removes that prefix from `req.path` inside a mounted handler. Reading
    // `path` therefore saw only the remainder — "/passkeys/authentication/
    // options" rather than the full route — and dropped ordinary authentication
    // traffic into the restrictive unclassified bucket, which is what made the
    // authentication end-to-end suite start returning 429.
    const risk = { emit: jest.fn() } as unknown as RiskClient;
    const middleware = new AuthRateLimitMiddleware(risk);
    const next = nextHarness();
    const { response, status } = responseHarness();

    // 60 passkey requests is exactly the family's budget, and well above the
    // unclassified bucket's 20. None may be rejected.
    for (let count = 0; count < 60; count += 1) {
      middleware.use(
        {
          ip: '127.0.0.1',
          originalUrl: '/api/v1/auth/passkeys/authentication/options',
          path: '/passkeys/authentication/options',
          method: 'POST',
        } as RequestContext,
        response,
        next,
      );
    }
    expect(next).toHaveBeenCalledTimes(60);
    expect(status).not.toHaveBeenCalledWith(429);
  });

  it('ignores the query string when classifying', () => {
    const risk = { emit: jest.fn() } as unknown as RiskClient;
    const middleware = new AuthRateLimitMiddleware(risk);
    const next = nextHarness();
    const { response, status } = responseHarness();

    for (let count = 0; count < 60; count += 1) {
      middleware.use(
        {
          ip: '127.0.0.1',
          originalUrl: `/api/v1/auth/session?cacheBust=${count}`,
          path: '/session',
        } as RequestContext,
        response,
        next,
      );
    }
    // A varying query must not mint new buckets, and must not be misclassified.
    expect(next).toHaveBeenCalledTimes(60);
    expect(status).not.toHaveBeenCalledWith(429);
  });

  it('never lets a telemetry failure turn a 429 into an error', () => {
    // `emit` validates against the Risk attribute allowlist and throws
    // synchronously on a mismatch. The rate-limit decision must survive that.
    const risk = {
      emit: jest.fn(() => {
        throw new Error('attribute is not allowlisted');
      }),
    } as unknown as RiskClient;
    const middleware = new AuthRateLimitMiddleware(risk);
    const next = nextHarness();
    const { response, status, json } = responseHarness();
    const request = {
      ip: '127.0.0.1',
      originalUrl: '/api/v1/auth/fallback/login',
      path: '/fallback/login',
      method: 'POST',
      correlationId: '11111111-1111-4111-8111-111111111111',
    } as RequestContext;

    expect(() => {
      for (let count = 0; count < 60; count += 1) {
        middleware.use(request, response, next);
      }
    }).not.toThrow();
    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalled();
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
