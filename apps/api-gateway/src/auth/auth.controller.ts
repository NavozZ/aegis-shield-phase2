import {
  createPinSchema,
  logoutSchema,
  passkeyAuthenticationOptionsSchema,
  passkeyAuthenticationVerificationSchema,
  passkeyRegistrationOptionsSchema,
  passkeyRegistrationVerificationSchema,
  pinFallbackLoginSchema,
  pinFallbackRequestSchema,
  requestOtpSchema,
  verifyOtpSchema,
} from '@aegis/contracts';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import { requireCsrfToken } from '../common/http/csrf';
import type { RequestContext } from '../common/http/request-context';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/gateway.config';
import {
  clearSessionCookies,
  type InternalSessionResponse,
  readCookie,
  setSessionCookies,
} from './cookies';
import { IDENTITY_ENDPOINTS, IdentityClient } from './identity.client';

function parse<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpException(
      {
        error: { code: 'INVALID_REQUEST', message: 'The request is invalid.' },
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  return parsed.data;
}

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly identity: IdentityClient,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
  ) {}

  private sessionId(request: RequestContext): string {
    return readCookie(request.header('cookie'), this.config.sessionCookieName);
  }

  private csrf(request: RequestContext, headerValue?: string): string {
    return requireCsrfToken(
      request.header('cookie'),
      this.config.csrfCookieName,
      headerValue,
    );
  }

  private async authenticate(
    endpoint:
      | typeof IDENTITY_ENDPOINTS.onboardingCreatePin
      | typeof IDENTITY_ENDPOINTS.fallbackLogin
      | typeof IDENTITY_ENDPOINTS.passkeyAuthenticationVerify,
    body: unknown,
    request: RequestContext,
    response: Response,
  ): Promise<unknown> {
    const created = await this.identity.request<InternalSessionResponse>(
      endpoint,
      'POST',
      request,
      body,
    );
    setSessionCookies(response, this.config, created);
    return created.session;
  }

  @Post('onboarding/request-otp')
  @HttpCode(HttpStatus.ACCEPTED)
  requestOnboardingOtp(@Body() body: unknown, @Req() request: RequestContext) {
    return this.identity.request(
      IDENTITY_ENDPOINTS.onboardingRequestOtp,
      'POST',
      request,
      parse(requestOtpSchema, body),
    );
  }

  @Post('onboarding/verify-otp')
  verifyOnboardingOtp(@Body() body: unknown, @Req() request: RequestContext) {
    return this.identity.request(
      IDENTITY_ENDPOINTS.onboardingVerifyOtp,
      'POST',
      request,
      parse(verifyOtpSchema, body),
    );
  }

  @Post('onboarding/create-pin')
  createPin(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authenticate(
      IDENTITY_ENDPOINTS.onboardingCreatePin,
      parse(createPinSchema, body),
      request,
      response,
    );
  }

  @Post('fallback/request-otp')
  @HttpCode(HttpStatus.ACCEPTED)
  requestFallbackOtp(@Body() body: unknown, @Req() request: RequestContext) {
    return this.identity.request(
      IDENTITY_ENDPOINTS.fallbackRequestOtp,
      'POST',
      request,
      parse(pinFallbackRequestSchema, body),
    );
  }

  @Post('fallback/login')
  fallbackLogin(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authenticate(
      IDENTITY_ENDPOINTS.fallbackLogin,
      parse(pinFallbackLoginSchema, body),
      request,
      response,
    );
  }

  @Get('session')
  session(@Req() request: RequestContext) {
    return this.identity.request(
      IDENTITY_ENDPOINTS.session,
      'GET',
      request,
      undefined,
      { sessionId: this.sessionId(request) },
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
    @Headers('x-csrf-token') csrfHeader?: string,
  ): Promise<{ revoked: true }> {
    parse(logoutSchema, body);
    const sessionId = this.sessionId(request);
    if (!sessionId) {
      clearSessionCookies(response, this.config);
      return { revoked: true };
    }
    try {
      const csrfToken = this.csrf(request, csrfHeader);
      await this.identity.request(
        IDENTITY_ENDPOINTS.logout,
        'POST',
        request,
        {},
        { sessionId, csrfToken },
      );
    } catch (error) {
      if (!(error instanceof HttpException) || error.getStatus() !== 401) {
        throw error;
      }
    } finally {
      clearSessionCookies(response, this.config);
    }
    return { revoked: true };
  }

  @Post('passkeys/registration/options')
  registrationOptions(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Headers('x-csrf-token') csrfHeader?: string,
  ) {
    return this.identity.request(
      IDENTITY_ENDPOINTS.passkeyRegistrationOptions,
      'POST',
      request,
      parse(passkeyRegistrationOptionsSchema, body),
      {
        sessionId: this.sessionId(request),
        csrfToken: this.csrf(request, csrfHeader),
      },
    );
  }

  @Post('passkeys/registration/verify')
  verifyRegistration(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Headers('x-csrf-token') csrfHeader?: string,
  ) {
    return this.identity.request(
      IDENTITY_ENDPOINTS.passkeyRegistrationVerify,
      'POST',
      request,
      parse(passkeyRegistrationVerificationSchema, body),
      {
        sessionId: this.sessionId(request),
        csrfToken: this.csrf(request, csrfHeader),
      },
    );
  }

  @Post('passkeys/authentication/options')
  authenticationOptions(@Body() body: unknown, @Req() request: RequestContext) {
    return this.identity.request(
      IDENTITY_ENDPOINTS.passkeyAuthenticationOptions,
      'POST',
      request,
      parse(passkeyAuthenticationOptionsSchema, body),
    );
  }

  @Post('passkeys/authentication/verify')
  verifyAuthentication(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authenticate(
      IDENTITY_ENDPOINTS.passkeyAuthenticationVerify,
      parse(passkeyAuthenticationVerificationSchema, body),
      request,
      response,
    );
  }
}
