import 'server-only';

import {
  sabclStatusResponseSchema,
  type SabclStatusResponse,
} from '@aegis/contracts';
import { cookies } from 'next/headers';
import { cache } from 'react';

/*
 * Operator view of the SABCL control plane.
 *
 * Read-only and server-side. The response is validated against the shared
 * strict contract, so if a status endpoint ever started returning a key, a
 * route token or a payload, this parse fails and the page renders
 * "unavailable" rather than displaying it. The page must not become a leak of
 * the thing the layer exists to hide.
 */

export type SabclStatusState =
  { status: 'ok'; data: SabclStatusResponse } | { status: 'unavailable' };

export const getSabclStatus = cache(async (): Promise<SabclStatusState> => {
  const sessionCookieName =
    process.env.AUTH_SESSION_COOKIE_NAME || 'aegis_session';
  const sessionCookie = (await cookies()).get(sessionCookieName)?.value;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(
      new URL(
        '/api/v1/sabcl/status',
        process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000',
      ),
      {
        headers: {
          accept: 'application/json',
          ...(sessionCookie
            ? {
                cookie: `${encodeURIComponent(sessionCookieName)}=${encodeURIComponent(sessionCookie)}`,
              }
            : {}),
          'x-correlation-id': crypto.randomUUID(),
        },
        cache: 'no-store',
        signal: controller.signal,
      },
    );
    if (!response.ok) return { status: 'unavailable' };
    const parsed = sabclStatusResponseSchema.safeParse(
      await response.json().catch(() => undefined),
    );
    return parsed.success
      ? { status: 'ok', data: parsed.data }
      : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
});
