'use client';
const base = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
function cookie(name: string) {
  return (
    document.cookie
      .split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith(`${name}=`))
      ?.slice(name.length + 1) || ''
  );
}
export async function operatorRequest<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; csrf?: boolean } = {},
): Promise<T> {
  const method = options.method || 'GET';
  const headers = new Headers({
    accept: 'application/json',
    'x-correlation-id': crypto.randomUUID(),
  });
  if (method === 'POST') headers.set('content-type', 'application/json');
  if (options.csrf)
    headers.set(
      'x-csrf-token',
      decodeURIComponent(cookie('aegis_operator_csrf')),
    );
  const response = await fetch(new URL(`/api/v1/security-ops${path}`, base), {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(options.body || {}) : undefined,
    credentials: 'include',
    cache: 'no-store',
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'OPERATOR_UNAUTHORIZED'
        : 'OPERATOR_REQUEST_FAILED',
    );
  return body as T;
}
