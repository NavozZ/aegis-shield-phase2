import 'server-only';
import { cookies } from 'next/headers';
export type OperatorState =
  | { status: 'authenticated'; operatorId: string }
  | { status: 'unauthenticated' }
  | { status: 'unavailable' };
export async function getServerOperator(): Promise<OperatorState> {
  const name = 'aegis_operator_session';
  const value = (await cookies()).get(name)?.value;
  if (!value) return { status: 'unauthenticated' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(
      new URL(
        '/api/v1/security-ops/session',
        process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000',
      ),
      {
        headers: {
          accept: 'application/json',
          cookie: `${name}=${encodeURIComponent(value)}`,
          'x-correlation-id': crypto.randomUUID(),
        },
        cache: 'no-store',
        signal: controller.signal,
      },
    );
    if (response.status === 401) return { status: 'unauthenticated' };
    if (!response.ok) return { status: 'unavailable' };
    const body = (await response.json()) as {
      operatorId?: unknown;
      role?: unknown;
    };
    return typeof body.operatorId === 'string' &&
      body.role === 'SECURITY_OPERATOR'
      ? { status: 'authenticated', operatorId: body.operatorId }
      : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}
