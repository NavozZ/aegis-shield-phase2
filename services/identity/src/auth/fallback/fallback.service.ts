import type {
  PinFallbackLoginInput,
  PinFallbackRequestInput,
} from '@aegis/contracts';
import { Injectable } from '@nestjs/common';
import { invalidCredentialsError } from '../../common/errors/auth.error';
import { PrismaService } from '../../database/prisma.service';
import { AuthEventService } from '../events/auth-event.service';
import { OtpService, type OtpRequestResult } from '../otp/otp.service';
import { PinService } from '../pin/pin.service';
import {
  SessionService,
  type CreatedSession,
} from '../sessions/session.service';

interface RequestContextData {
  correlationId: string;
  ipHash: string;
  userAgent?: string;
}

@Injectable()
export class FallbackService {
  private readonly maxFailures = 5;
  private readonly lockSeconds = 300;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pins: PinService,
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly events: AuthEventService,
  ) {}

  private async verifyPin(
    phone: string,
    pin: string,
    context: RequestContextData,
  ) {
    const user = await this.prisma.client.user.findUnique({
      where: { phoneE164: phone },
      include: { pinCredential: true },
    });
    if (!user?.pinCredential) {
      await this.pins.performDummyVerification(pin);
      throw invalidCredentialsError();
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw invalidCredentialsError();
    }
    const valid = await this.pins.verifyPin(user.pinCredential.pinHash, pin);
    if (!valid || (user.status !== 'ACTIVE' && user.status !== 'LOCKED')) {
      const failures = user.failedLoginCount + 1;
      const locked = failures >= this.maxFailures;
      await this.prisma.client.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failures,
          status: locked ? 'LOCKED' : user.status,
          lockedUntil: locked
            ? new Date(Date.now() + this.lockSeconds * 1_000)
            : user.lockedUntil,
        },
      });
      await this.events.record({
        userId: user.id,
        eventType: locked ? 'ACCOUNT_LOCKED' : 'PIN_LOGIN_FAILED',
        outcome: 'FAILURE',
        phone,
        correlationId: context.correlationId,
        ipHash: context.ipHash,
        userAgent: context.userAgent,
        metadata: { temporary: locked },
      });
      throw invalidCredentialsError();
    }
    return user;
  }

  async requestOtp(
    input: PinFallbackRequestInput,
    context: RequestContextData,
  ): Promise<OtpRequestResult> {
    const user = await this.verifyPin(input.phone, input.pin, context);
    const result = await this.otp.request(
      input.phone,
      'FALLBACK',
      context.ipHash,
    );
    await this.events.record({
      userId: user.id,
      eventType: 'OTP_REQUESTED',
      outcome: 'ACCEPTED',
      phone: input.phone,
      correlationId: context.correlationId,
      ipHash: context.ipHash,
      userAgent: context.userAgent,
      metadata: { purpose: 'FALLBACK' },
    });
    return result;
  }

  async login(
    input: PinFallbackLoginInput,
    context: RequestContextData,
  ): Promise<CreatedSession> {
    const user = await this.verifyPin(input.phone, input.pin, context);
    await this.otp.verify(
      input.phone,
      input.challengeId,
      input.otp,
      'FALLBACK',
    );
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: {
        status: 'ACTIVE',
        failedLoginCount: 0,
        lockedUntil: null,
        lastAuthenticatedAt: new Date(),
      },
    });
    await this.events.record({
      userId: user.id,
      eventType: 'PIN_LOGIN_SUCCEEDED',
      outcome: 'SUCCESS',
      phone: input.phone,
      correlationId: context.correlationId,
      ipHash: context.ipHash,
      userAgent: context.userAgent,
      metadata: { secondFactor: 'OTP' },
    });
    return this.sessions.create(user.id, 'PIN_OTP', input.deviceId);
  }
}
