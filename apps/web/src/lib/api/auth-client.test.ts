import { afterEach, describe, expect, it, vi } from 'vitest';
import { authClient, AuthClientError } from './auth-client';
import { readCsrfToken } from './csrf';

const challengeId = '550e8400-e29b-41d4-a716-446655440001';
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.cookie = 'aegis_csrf=; Max-Age=0; Path=/';
});

describe('authentication API client', () => {
  it('includes credentials, no-store caching and a correlation ID', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ accepted: true, challengeId }, 202));
    vi.stubGlobal('fetch', fetchMock);
    await authClient.requestOnboardingOtp({
      phone: '+12025550123',
      preferredLanguage: 'EN',
      consentAccepted: true,
    });
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(init.credentials).toBe('include');
    expect(init.cache).toBe('no-store');
    expect((init.headers as Headers).get('x-correlation-id')).toMatch(
      /^[0-9a-f-]{36}$/u,
    );
  });

  it('rejects malformed success responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ accepted: true }, 202)),
    );
    await expect(
      authClient.requestOnboardingOtp({
        phone: '+12025550123',
        preferredLanguage: 'EN',
        consentAccepted: true,
      }),
    ).rejects.toMatchObject({ kind: 'unexpected' });
  });

  it.each([
    [401, 'authentication_failed'],
    [403, 'authentication_failed'],
    [429, 'rate_limited'],
    [503, 'service_unavailable'],
  ] as const)('normalizes HTTP %s safely', async (status, kind) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: status === 403 ? 'FORBIDDEN' : 'AUTHENTICATION_FAILED',
              message: 'Safe failure',
              correlationId: challengeId,
            },
          },
          status,
        ),
      ),
    );
    await expect(
      authClient.requestFallbackOtp({ phone: '+12025550123', pin: '739182' }),
    ).rejects.toMatchObject({ kind });
  });

  it('aborts a timed-out request without exposing details', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: URL, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            ),
          ),
      ),
    );
    const pending = authClient.getSession();
    const rejection = expect(pending).rejects.toMatchObject({
      kind: 'network_unavailable',
    });
    await vi.advanceTimersByTimeAsync(8_001);
    await rejection;
  });

  it('does not log sensitive request values', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ accepted: true, challengeId, demoOtp: '482610' }, 202),
        ),
    );
    await authClient.requestFallbackOtp({
      phone: '+12025550123',
      pin: '739182',
    });
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('includes the focused CSRF header on logout', async () => {
    document.cookie = 'aegis_csrf=safe-test-token; Path=/';
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ revoked: true }));
    vi.stubGlobal('fetch', fetchMock);
    expect(readCsrfToken()).toBe('safe-test-token');
    await authClient.logout();
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((init.headers as Headers).get('x-csrf-token')).toBe(
      'safe-test-token',
    );
  });

  it('rejects authenticated mutation when the CSRF token is absent', async () => {
    await expect(
      authClient.requestPasskeyRegistrationOptions(),
    ).rejects.toBeInstanceOf(AuthClientError);
  });
});
