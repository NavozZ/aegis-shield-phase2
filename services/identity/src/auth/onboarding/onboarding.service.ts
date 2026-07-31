import type {
  CreatePinInput,
  MaskedUser,
  RequestOtpInput,
  VerifyOtpInput,
} from '@aegis/contracts';
import { HttpStatus, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AuthError } from '../../common/errors/auth.error';
import { maskPhone, sha256 } from '../../common/security/security';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuthEventService } from '../events/auth-event.service';
import { OtpService, type OtpRequestResult } from '../otp/otp.service';
import { PIN_ALGORITHM, PinService } from '../pin/pin.service';
import {
  SessionService,
  type CreatedSession,
} from '../sessions/session.service';

interface RequestContextData {
  correlationId: string;
  ipHash: string;
  userAgent?: string;
}

export interface EnrollmentResult {
  enrollmentToken: string;
  expiresInSeconds: number;
  user: MaskedUser;
}

@Injectable()
export class OnboardingService {
  private readonly enrollmentTtlSeconds = 600;

  constructor(
    private readonly otp: OtpService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly pins: PinService,
    private readonly sessions: SessionService,
    private readonly events: AuthEventService,
  ) {}

  async requestOtp(
    input: RequestOtpInput,
    context: RequestContextData,
  ): Promise<OtpRequestResult> {
    const result = await this.otp.request(
      input.phone,
      'ONBOARDING',
      context.ipHash,
      {
        preferredLanguage: input.preferredLanguage,
        consentAcceptedAt: new Date().toISOString(),
      },
    );
    await this.events.record({
      eventType: 'OTP_REQUESTED',
      outcome: 'ACCEPTED',
      phone: input.phone,
      correlationId: context.correlationId,
      ipHash: context.ipHash,
      userAgent: context.userAgent,
      metadata: { purpose: 'ONBOARDING' },
    });
    return result;
  }

  async verifyOtp(
    input: VerifyOtpInput,
    context: RequestContextData,
  ): Promise<EnrollmentResult> {
    const challenge = await this.otp.verify(
      input.phone,
      input.challengeId,
      input.otp,
      'ONBOARDING',
    );
    const existing = await this.prisma.client.user.findUnique({
      where: { phoneE164: input.phone },
    });
    if (existing && existing.status !== 'PENDING') {
      throw new AuthError(
        'ONBOARDING_UNAVAILABLE',
        'Onboarding could not be completed.',
        HttpStatus.CONFLICT,
      );
    }

    const verifiedAt = new Date();
    const user = existing
      ? await this.prisma.client.user.update({
          where: { id: existing.id },
          data: {
            phoneVerifiedAt: verifiedAt,
            preferredLanguage: challenge.preferredLanguage as
              'EN' | 'SI' | 'TA',
            consentAcceptedAt: new Date(
              challenge.consentAcceptedAt ?? verifiedAt.toISOString(),
            ),
          },
        })
      : await this.prisma.client.user.create({
          data: {
            phoneE164: input.phone,
            preferredLanguage: challenge.preferredLanguage as
              'EN' | 'SI' | 'TA',
            consentAcceptedAt: new Date(
              challenge.consentAcceptedAt ?? verifiedAt.toISOString(),
            ),
            phoneVerifiedAt: verifiedAt,
          },
        });

    const enrollmentToken = randomBytes(32).toString('base64url');
    await this.redis.set(
      this.redis.key('enrollment', sha256(enrollmentToken)),
      JSON.stringify({ userId: user.id }),
      this.enrollmentTtlSeconds,
    );
    await this.events.record({
      userId: user.id,
      eventType: existing ? 'OTP_VERIFIED' : 'USER_CREATED',
      outcome: 'SUCCESS',
      phone: input.phone,
      correlationId: context.correlationId,
      ipHash: context.ipHash,
      userAgent: context.userAgent,
      metadata: { purpose: 'ONBOARDING' },
    });

    return {
      enrollmentToken,
      expiresInSeconds: this.enrollmentTtlSeconds,
      user: {
        id: user.id,
        phoneMasked: maskPhone(user.phoneE164),
        preferredLanguage: user.preferredLanguage,
        kycTier: user.kycTier,
        status: user.status,
        phoneVerified: true,
      },
    };
  }

  async createPin(
    input: CreatePinInput,
    context: RequestContextData,
  ): Promise<CreatedSession> {
    const pinHash = await this.pins.hashPin(input.pin);
    const enrollmentKey = this.redis.key(
      'enrollment',
      sha256(input.enrollmentToken),
    );
    const rawEnrollment = await this.redis.getDel(enrollmentKey);
    if (!rawEnrollment) {
      throw new AuthError(
        'INVALID_ENROLLMENT',
        'The enrollment token is invalid or expired.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const { userId } = JSON.parse(rawEnrollment) as { userId: string };
    const user = await this.prisma.client.$transaction(async (transaction) => {
      await transaction.pinCredential.upsert({
        where: { userId },
        create: { userId, pinHash, algorithm: PIN_ALGORITHM },
        update: {
          pinHash,
          algorithm: PIN_ALGORITHM,
          rotatedAt: new Date(),
        },
      });
      return transaction.user.update({
        where: { id: userId, status: 'PENDING' },
        data: {
          status: 'ACTIVE',
          failedLoginCount: 0,
          lockedUntil: null,
          lastAuthenticatedAt: new Date(),
        },
      });
    });
    await this.events.record({
      userId,
      eventType: 'PIN_CONFIGURED',
      outcome: 'SUCCESS',
      phone: user.phoneE164,
      correlationId: context.correlationId,
      ipHash: context.ipHash,
      userAgent: context.userAgent,
      metadata: { algorithm: PIN_ALGORITHM },
    });
    return this.sessions.create(userId, 'PIN_OTP', input.deviceId);
  }
}
