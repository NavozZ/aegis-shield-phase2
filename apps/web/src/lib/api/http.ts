import { standardErrorResponseSchema } from '@aegis/contracts';
import { csrfHeader } from './csrf';

export type AuthErrorKind =
  | 'invalid_input'
  | 'invalid_otp'
  | 'rate_limited'
  | 'temporarily_locked'
  | 'authentication_failed'
  | 'session_expired'
  | 'request_conflict'
  | 'service_unavailable'
  | 'network_unavailable'
  | 'unexpected';

export class AuthClientError extends Error {
  constructor(
    readonly kind: AuthErrorKind,
    readonly status?: number,
  ) {
    super(kind);
    this.name = 'AuthClientError';
  }
}

export interface SafeSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const REQUEST_TIMEOUT_MS = 8_000;

export function mapHttpError(
  status: number,
  body: unknown,
  unauthenticatedKind: AuthErrorKind,
): AuthClientError {
  const parsed = standardErrorResponseSchema.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : '';
  if (status === 400) return new AuthClientError('invalid_input', status);
  if (status === 403)
    return new AuthClientError(
      code === 'INVALID_CSRF' ? 'session_expired' : 'authentication_failed',
      status,
    );
  if (status === 404) return new AuthClientError('unexpected', status);
  if (status === 409) return new AuthClientError('request_conflict', status);
  if (status === 429) return new AuthClientError('rate_limited', status);
  if (status === 503) return new AuthClientError('service_unavailable', status);
  if (status === 401) {
    if (/OTP|CHALLENGE|ENROLLMENT/u.test(code))
      return new AuthClientError('invalid_otp', status);
    if (code === 'UNAUTHENTICATED')
      return new AuthClientError('session_expired', status);
    return new AuthClientError(unauthenticatedKind, status);
  }
  return new AuthClientError('unexpected', status);
}

export async function request<T>(
  path: string,
  schema: SafeSchema<T>,
  options: {
    method?: 'GET' | 'POST';
    body?: unknown;
    csrf?: 'required' | 'optional';
    headers?: Record<string, string>;
    unauthenticatedKind?: AuthErrorKind;
  } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const method = options.method ?? 'POST';
    const headers = new Headers({
      accept: 'application/json',
      'x-correlation-id': crypto.randomUUID(),
    });
    if (method === 'POST') headers.set('content-type', 'application/json');
    if (options.csrf) {
      const values = csrfHeader(options.csrf === 'required');
      for (const [name, value] of Object.entries(values))
        headers.set(name, value);
    }
    for (const [name, value] of Object.entries(options.headers ?? {}))
      headers.set(name, value);

    const response = await fetch(new URL(path, API_BASE_URL), {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined,
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    });
    const responseBody: unknown = await response.json().catch(() => undefined);
    if (!response.ok)
      throw mapHttpError(
        response.status,
        responseBody,
        options.unauthenticatedKind ?? 'authentication_failed',
      );
    const parsed = schema.safeParse(responseBody);
    if (!parsed.success)
      throw new AuthClientError('unexpected', response.status);
    return parsed.data;
  } catch (error) {
    if (error instanceof AuthClientError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError')
      throw new AuthClientError('network_unavailable');
    if (error instanceof Error && error.message === 'CSRF_TOKEN_MISSING')
      throw new AuthClientError('session_expired');
    throw new AuthClientError('network_unavailable');
  } finally {
    clearTimeout(timeout);
  }
}
