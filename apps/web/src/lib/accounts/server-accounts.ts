import 'server-only';

import {
  customerAccountDetailSchema,
  customerAccountListSchema,
  type CustomerAccountDetail,
} from '@aegis/contracts';
import { cookies } from 'next/headers';
import { cache } from 'react';

export type ServerAccountState =
  | { status: 'ready'; account: CustomerAccountDetail | null }
  | { status: 'unauthenticated' }
  | { status: 'unavailable' };

async function fetchFromGateway(
  path: string,
  sessionCookieName: string,
  sessionCookie: string,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(
      new URL(
        path,
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
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json().catch(() => undefined),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Loads the customer's default account for the first paint.
 *
 * The list is fetched first, then the detail of the default account so that the
 * balance shown always comes from the API rather than being assumed.
 */
export const getServerAccount = cache(async (): Promise<ServerAccountState> => {
  const sessionCookieName =
    process.env.AUTH_SESSION_COOKIE_NAME || 'aegis_session';
  const sessionCookie = (await cookies()).get(sessionCookieName)?.value;
  if (!sessionCookie) return { status: 'unauthenticated' };

  try {
    const listed = await fetchFromGateway(
      '/api/v1/accounts',
      sessionCookieName,
      sessionCookie,
    );
    if (listed.status === 401) return { status: 'unauthenticated' };
    if (!listed.ok) return { status: 'unavailable' };

    const accounts = customerAccountListSchema.safeParse(listed.body);
    if (!accounts.success) return { status: 'unavailable' };

    const first = accounts.data.accounts[0];
    if (!first) return { status: 'ready', account: null };

    const detail = await fetchFromGateway(
      `/api/v1/accounts/${encodeURIComponent(first.id)}`,
      sessionCookieName,
      sessionCookie,
    );
    if (detail.status === 401) return { status: 'unauthenticated' };
    if (!detail.ok) return { status: 'unavailable' };

    const parsed = customerAccountDetailSchema.safeParse(detail.body);
    return parsed.success
      ? { status: 'ready', account: parsed.data }
      : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
});
