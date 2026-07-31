import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookieValue: undefined as string | undefined,
  cookies: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  mocks.cookieValue = undefined;
  mocks.cookies.mockReset();
  mocks.cookies.mockImplementation(async () => ({
    get: () => (mocks.cookieValue ? { value: mocks.cookieValue } : undefined),
  }));
});

describe('server session state', () => {
  it('returns unauthenticated without forwarding a request when no cookie exists', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { getServerSession } = await import('./server-session');

    await expect(getServerSession()).resolves.toEqual({
      status: 'unauthenticated',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats an expired or revoked session as unauthenticated', async () => {
    mocks.cookieValue = 'opaque-test-session';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );
    const { getServerSession } = await import('./server-session');

    await expect(getServerSession()).resolves.toEqual({
      status: 'unauthenticated',
    });
  });
});
