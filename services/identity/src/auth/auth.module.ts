import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthEventService } from './events/auth-event.service';
import { FallbackService } from './fallback/fallback.service';
import { OnboardingService } from './onboarding/onboarding.service';
import {
  DemoOtpProvider,
  DisabledOtpProvider,
  otpProviderFactory,
} from './otp/otp.provider';
import { OtpService } from './otp/otp.service';
import { PasskeyService } from './passkeys/passkey.service';
import { WebAuthnAdapter } from './passkeys/webauthn.adapter';
import { PinService } from './pin/pin.service';
import { SessionService } from './sessions/session.service';
import { TransferStepUpService } from './step-up/transfer-step-up.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthEventService,
    DemoOtpProvider,
    DisabledOtpProvider,
    otpProviderFactory,
    OtpService,
    PinService,
    SessionService,
    OnboardingService,
    FallbackService,
    WebAuthnAdapter,
    PasskeyService,
    TransferStepUpService,
  ],
})
export class AuthModule {}
