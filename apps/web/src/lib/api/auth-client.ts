import {
  enrollmentResponseSchema,
  logoutResponseSchema,
  otpAcceptedResponseSchema,
  passkeyAuthenticationOptionsResponseSchema,
  passkeyRegistrationOptionsResponseSchema,
  passkeyVerifiedResponseSchema,
  sessionResponseSchema,
  standardErrorResponseSchema,
  type CreatePinInput,
  type EnrollmentResponse,
  type LogoutResponse,
  type OtpAcceptedResponse,
  type PasskeyAuthenticationOptionsResponse,
  type PasskeyAuthenticationVerificationInput,
  type PasskeyRegistrationOptionsResponse,
  type PasskeyRegistrationVerificationInput,
  type PasskeyVerifiedResponse,
  type PinFallbackLoginInput,
  type PinFallbackRequestInput,
  type RequestOtpInput,
  type SessionResponse,
  type VerifyOtpInput,
} from '@aegis/contracts';
import { csrfHeader } from './csrf';

export type AuthErrorKind =
  | 'invalid_input'
  | 'invalid_otp'
  | 'rate_limited'
  | 'temporarily_locked'
  | 'authentication_failed'
  | 'session_expired'
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

interface SafeSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const REQUEST_TIMEOUT_MS = 8_000;

function mapHttpError(
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

async function request<T>(
  path: string,
  schema: SafeSchema<T>,
  options: {
    method?: 'GET' | 'POST';
    body?: unknown;
    csrf?: 'required' | 'optional';
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

export const authClient = {
  requestOnboardingOtp(input: RequestOtpInput): Promise<OtpAcceptedResponse> {
    return request(
      '/api/v1/auth/onboarding/request-otp',
      otpAcceptedResponseSchema,
      { body: input },
    );
  },
  verifyOnboardingOtp(input: VerifyOtpInput): Promise<EnrollmentResponse> {
    return request(
      '/api/v1/auth/onboarding/verify-otp',
      enrollmentResponseSchema,
      { body: input, unauthenticatedKind: 'invalid_otp' },
    );
  },
  createPin(input: CreatePinInput): Promise<SessionResponse> {
    return request(
      '/api/v1/auth/onboarding/create-pin',
      sessionResponseSchema,
      { body: input },
    );
  },
  requestFallbackOtp(
    input: PinFallbackRequestInput,
  ): Promise<OtpAcceptedResponse> {
    return request(
      '/api/v1/auth/fallback/request-otp',
      otpAcceptedResponseSchema,
      { body: input },
    );
  },
  completeFallbackLogin(
    input: PinFallbackLoginInput,
  ): Promise<SessionResponse> {
    return request('/api/v1/auth/fallback/login', sessionResponseSchema, {
      body: input,
      unauthenticatedKind: 'authentication_failed',
    });
  },
  requestPasskeyRegistrationOptions(): Promise<PasskeyRegistrationOptionsResponse> {
    return request(
      '/api/v1/auth/passkeys/registration/options',
      passkeyRegistrationOptionsResponseSchema,
      { body: {}, csrf: 'required' },
    );
  },
  verifyPasskeyRegistration(
    input: PasskeyRegistrationVerificationInput,
  ): Promise<PasskeyVerifiedResponse> {
    return request(
      '/api/v1/auth/passkeys/registration/verify',
      passkeyVerifiedResponseSchema,
      { body: input, csrf: 'required' },
    );
  },
  requestPasskeyAuthenticationOptions(): Promise<PasskeyAuthenticationOptionsResponse> {
    return request(
      '/api/v1/auth/passkeys/authentication/options',
      passkeyAuthenticationOptionsResponseSchema,
      { body: {} },
    );
  },
  verifyPasskeyAuthentication(
    input: PasskeyAuthenticationVerificationInput,
  ): Promise<SessionResponse> {
    return request(
      '/api/v1/auth/passkeys/authentication/verify',
      sessionResponseSchema,
      { body: input },
    );
  },
  getSession(): Promise<SessionResponse> {
    return request('/api/v1/auth/session', sessionResponseSchema, {
      method: 'GET',
      unauthenticatedKind: 'session_expired',
    });
  },
  logout(): Promise<LogoutResponse> {
    return request('/api/v1/auth/logout', logoutResponseSchema, {
      body: {},
      csrf: 'optional',
      unauthenticatedKind: 'session_expired',
    });
  },
};
