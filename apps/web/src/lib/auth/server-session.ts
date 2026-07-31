import 'server-only';

import { sessionResponseSchema, type SessionResponse } from '@aegis/contracts';
import { cookies } from 'next/headers';
import { cache } from 'react';

export type ServerSessionState =
  | { status: 'authenticated'; session: SessionResponse }
  | { status: 'unauthenticated' }
  | { status: 'unavailable' };

export const getServerSession = cache(async (): Promise<ServerSessionState> => {
  const sessionCookieName =
    process.env.AUTH_SESSION_COOKIE_NAME || 'aegis_session';
  const sessionCookie = (await cookies()).get(sessionCookieName)?.value;
  if (!sessionCookie) return { status: 'unauthenticated' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(
      new URL(
        '/api/v1/auth/session',
        process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000',
      ),
      {
        headers: {
          accept: 'application/json',
          cookie: `${encodeURIComponent(sessionCookieName)}=${encodeURIComponent(sessionCookie)}`,
          'x-correlation-id': crypto.randomUUID(),
        },
        cache: 'no-store',
        signal: controller.signal,
      },
    );
    if (response.status === 401) return { status: 'unauthenticated' };
    if (!response.ok) return { status: 'unavailable' };
    const parsed = sessionResponseSchema.safeParse(
      await response.json().catch(() => undefined),
    );
    return parsed.success
      ? { status: 'authenticated', session: parsed.data }
      : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
});
