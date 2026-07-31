import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/gateway.config';
import type { RequestContext } from '../common/http/request-context';

export const IDENTITY_ENDPOINTS = {
  onboardingRequestOtp: '/api/v1/auth/onboarding/request-otp',
  onboardingVerifyOtp: '/api/v1/auth/onboarding/verify-otp',
  onboardingCreatePin: '/api/v1/auth/onboarding/create-pin',
  fallbackRequestOtp: '/api/v1/auth/fallback/request-otp',
  fallbackLogin: '/api/v1/auth/fallback/login',
  session: '/api/v1/auth/session',
  logout: '/api/v1/auth/logout',
  passkeyRegistrationOptions: '/api/v1/auth/passkeys/registration/options',
  passkeyRegistrationVerify: '/api/v1/auth/passkeys/registration/verify',
  passkeyAuthenticationOptions: '/api/v1/auth/passkeys/authentication/options',
  passkeyAuthenticationVerify: '/api/v1/auth/passkeys/authentication/verify',
  ready: '/health/ready',
} as const;

export type IdentityEndpoint =
  (typeof IDENTITY_ENDPOINTS)[keyof typeof IDENTITY_ENDPOINTS];

export class IdentityHttpError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: unknown,
  ) {
    super(`Identity returned HTTP ${status}.`);
  }
}

@Injectable()
export class IdentityClient {
  constructor(@Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig) {}

  async request<T>(
    endpoint: IdentityEndpoint,
    method: 'GET' | 'POST',
    request: RequestContext,
    body?: unknown,
    auth?: { sessionId: string; csrfToken?: string },
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.identityTimeoutMs,
    );
    try {
      const headers = new Headers({
        accept: 'application/json',
        'content-type': 'application/json',
        'x-aegis-internal-token': this.config.identityInternalToken,
        'x-correlation-id': request.correlationId,
        'x-aegis-client-ip-hash': createHash('sha256')
          .update(request.ip || 'unknown')
          .digest('hex'),
      });
      const userAgent = request.header('user-agent');
      if (userAgent) headers.set('x-aegis-user-agent', userAgent.slice(0, 512));
      if (auth?.sessionId) headers.set('x-aegis-session-id', auth.sessionId);
      if (auth?.csrfToken) headers.set('x-csrf-token', auth.csrfToken);

      const response = await fetch(
        new URL(endpoint, this.config.identityServiceUrl),
        {
          method,
          headers,
          body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
          signal: controller.signal,
        },
      );
      const responseBody: unknown = await response
        .json()
        .catch(() => undefined);
      if (!response.ok) {
        throw new IdentityHttpError(response.status, responseBody);
      }
      return responseBody as T;
    } catch (error) {
      if (error instanceof IdentityHttpError) {
        throw new HttpException(error.responseBody ?? {}, error.status);
      }
      throw new HttpException({}, HttpStatus.SERVICE_UNAVAILABLE);
    } finally {
      clearTimeout(timeout);
    }
  }

  async ready(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.identityTimeoutMs,
    );
    try {
      const response = await fetch(
        new URL(IDENTITY_ENDPOINTS.ready, this.config.identityServiceUrl),
        {
          headers: {
            'x-aegis-internal-token': this.config.identityInternalToken,
          },
          signal: controller.signal,
        },
      );
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}
