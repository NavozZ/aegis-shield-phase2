import type { GatewayConfig } from '../config/gateway.config';
import { clearSessionCookies, readCookie, setSessionCookies } from './cookies';

function responseRecorder() {
  const headers = new Map<string, string[]>();
  return {
    headers,
    response: {
      setHeader: (name: string, value: string[]) => headers.set(name, value),
    },
  };
}

const configuration = {
  nodeEnvironment: 'development',
  sessionCookieName: 'aegis_session',
  csrfCookieName: 'aegis_csrf',
} as GatewayConfig;

describe('authentication cookies', () => {
  it('sets an HttpOnly session and readable double-submit CSRF cookie', () => {
    const recorder = responseRecorder();
    setSessionCookies(recorder.response as never, configuration, {
      sessionId: 'opaque-session',
      csrfToken: 'random-csrf',
      maxAgeSeconds: 600,
      session: {},
    });
    const [session, csrf] = recorder.headers.get('set-cookie')!;
    expect(session).toContain('HttpOnly');
    expect(session).toContain('SameSite=Lax');
    expect(session).toContain('Max-Age=600');
    expect(session).not.toContain('Domain=');
    expect(csrf).not.toContain('HttpOnly');
    expect(session).not.toContain('Secure');
  });

  it('adds Secure in production and expires both values on logout', () => {
    const production = { ...configuration, nodeEnvironment: 'production' };
    const recorder = responseRecorder();
    clearSessionCookies(recorder.response as never, production);
    for (const cookie of recorder.headers.get('set-cookie')!) {
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('Max-Age=0');
    }
  });

  it('parses exact cookie names without prefix confusion', () => {
    expect(
      readCookie('x_aegis_session=wrong; aegis_session=right', 'aegis_session'),
    ).toBe('right');
  });
});
