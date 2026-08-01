import {
  createPinSchema,
  passkeyAuthenticationVerificationSchema,
  passkeyRegistrationVerificationSchema,
  pinFallbackLoginSchema,
  pinFallbackRequestSchema,
  requestOtpSchema,
  pinStepUpRequestSchema,
  verifyOtpSchema,
} from '@aegis/contracts';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { AuthError } from '../common/errors/auth.error';
import { parseInput } from '../common/http/zod';
import type { RequestContext } from '../common/http/request-context';
import { sha256 } from '../common/security/security';
import { FallbackService } from './fallback/fallback.service';
import { OnboardingService } from './onboarding/onboarding.service';
import { PasskeyService } from './passkeys/passkey.service';
import { SessionService } from './sessions/session.service';
import { TransferStepUpService } from './step-up/transfer-step-up.service';

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly fallback: FallbackService,
    private readonly sessions: SessionService,
    private readonly passkeys: PasskeyService,
    private readonly stepUp: TransferStepUpService,
  ) {}

  private requestContext(request: RequestContext) {
    const suppliedIpHash = request.header('x-aegis-client-ip-hash') || '';
    return {
      correlationId: request.correlationId,
      ipHash: /^[a-f0-9]{64}$/u.test(suppliedIpHash)
        ? suppliedIpHash
        : sha256(request.ip || 'unknown'),
      userAgent:
        request.header('x-aegis-user-agent')?.slice(0, 512) ||
        request.header('user-agent'),
    };
  }

  private requiredHeader(value: string | undefined, code: string): string {
    if (!value?.trim()) {
      throw new AuthError(
        code,
        'Authentication is required.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return value.trim();
  }

  @Post('onboarding/request-otp')
  @HttpCode(HttpStatus.ACCEPTED)
  requestOnboardingOtp(@Body() body: unknown, @Req() request: RequestContext) {
    return this.onboarding.requestOtp(
      parseInput(requestOtpSchema, body),
      this.requestContext(request),
    );
  }

  @Post('onboarding/verify-otp')
  verifyOnboardingOtp(@Body() body: unknown, @Req() request: RequestContext) {
    return this.onboarding.verifyOtp(
      parseInput(verifyOtpSchema, body),
      this.requestContext(request),
    );
  }

  @Post('onboarding/create-pin')
  createPin(@Body() body: unknown, @Req() request: RequestContext) {
    return this.onboarding.createPin(
      parseInput(createPinSchema, body),
      this.requestContext(request),
    );
  }

  @Post('fallback/request-otp')
  @HttpCode(HttpStatus.ACCEPTED)
  requestFallbackOtp(@Body() body: unknown, @Req() request: RequestContext) {
    return this.fallback.requestOtp(
      parseInput(pinFallbackRequestSchema, body),
      this.requestContext(request),
    );
  }

  @Post('fallback/login')
  fallbackLogin(@Body() body: unknown, @Req() request: RequestContext) {
    return this.fallback.login(
      parseInput(pinFallbackLoginSchema, body),
      this.requestContext(request),
    );
  }

  @Get('session')
  getSession(@Headers('x-aegis-session-id') sessionId?: string) {
    return this.sessions.get(this.requiredHeader(sessionId, 'UNAUTHENTICATED'));
  }

  @Post('transfer-step-up')
  stepUpTransfer(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Headers('x-aegis-session-id') sessionId?: string,
  ) {
    return this.stepUp.verify(
      this.requiredHeader(sessionId, 'UNAUTHENTICATED'),
      parseInput(pinStepUpRequestSchema, body).pin,
      this.requestContext(request),
    );
  }

  @Post('logout')
  async logout(
    @Headers('x-aegis-session-id') sessionId?: string,
    @Headers('x-csrf-token') csrfToken?: string,
  ): Promise<{ revoked: true }> {
    await this.sessions.revoke(
      this.requiredHeader(sessionId, 'UNAUTHENTICATED'),
      this.requiredHeader(csrfToken, 'INVALID_CSRF'),
    );
    return { revoked: true };
  }

  @Post('passkeys/registration/options')
  registrationOptions(
    @Headers('x-aegis-session-id') sessionId?: string,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    return this.passkeys.registrationOptions(
      this.requiredHeader(sessionId, 'UNAUTHENTICATED'),
      this.requiredHeader(csrfToken, 'INVALID_CSRF'),
    );
  }

  @Post('passkeys/registration/verify')
  verifyRegistration(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Headers('x-aegis-session-id') sessionId?: string,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    return this.passkeys.verifyRegistration(
      this.requiredHeader(sessionId, 'UNAUTHENTICATED'),
      this.requiredHeader(csrfToken, 'INVALID_CSRF'),
      parseInput(passkeyRegistrationVerificationSchema, body),
      request.correlationId,
    );
  }

  @Post('passkeys/authentication/options')
  authenticationOptions(@Req() request: RequestContext) {
    return this.passkeys.authenticationOptions(
      this.requestContext(request).ipHash,
    );
  }

  @Post('passkeys/authentication/verify')
  verifyAuthentication(@Body() body: unknown, @Req() request: RequestContext) {
    const context = this.requestContext(request);
    return this.passkeys.verifyAuthentication(
      parseInput(passkeyAuthenticationVerificationSchema, body),
      context.ipHash,
      context.correlationId,
    );
  }
}
