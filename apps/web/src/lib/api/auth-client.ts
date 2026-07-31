import {
  enrollmentResponseSchema,
  logoutResponseSchema,
  otpAcceptedResponseSchema,
  passkeyAuthenticationOptionsResponseSchema,
  passkeyRegistrationOptionsResponseSchema,
  passkeyVerifiedResponseSchema,
  sessionResponseSchema,
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
import { request } from './http';

export { AuthClientError } from './http';
export type { AuthErrorKind } from './http';

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
