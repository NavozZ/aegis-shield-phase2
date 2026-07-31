import { randomInt, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  IDENTITY_CONFIG,
  type IdentityConfig,
} from '../../common/config/identity.config';
import { AuthError } from '../../common/errors/auth.error';
import {
  keyedDigest,
  timingSafeStringEqual,
} from '../../common/security/security';
import { RedisService } from '../../redis/redis.service';
import { OTP_PROVIDER, type OtpProvider } from './otp.provider';

export type OtpPurpose = 'ONBOARDING' | 'FALLBACK';

export interface StoredOtpChallenge {
  phoneHash: string;
  codeHash: string;
  purpose: OtpPurpose;
  attempts: number;
  preferredLanguage?: string;
  consentAcceptedAt?: string;
}

export interface OtpRequestResult {
  accepted: true;
  challengeId: string;
  demoOtp?: string;
}

@Injectable()
export class OtpService {
  constructor(
    private readonly redis: RedisService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
    @Inject(OTP_PROVIDER) private readonly provider: OtpProvider,
  ) {}

  private phoneHash(phone: string): string {
    return keyedDigest(phone, this.config.internalToken);
  }

  private async rateLimitAllows(
    phoneHash: string,
    ipHash: string,
  ): Promise<boolean> {
    const phoneCount = await this.redis.incrementWithTtl(
      this.redis.key('otp', 'rate', 'phone', phoneHash),
      3_600,
    );
    const ipCount = await this.redis.incrementWithTtl(
      this.redis.key('otp', 'rate', 'ip', ipHash),
      3_600,
    );
    return (
      phoneCount <= this.config.otpRequestLimitPerHour &&
      ipCount <= this.config.otpRequestLimitPerHour * 4
    );
  }

  async request(
    phone: string,
    purpose: OtpPurpose,
    ipHash: string,
    context?: { preferredLanguage?: string; consentAcceptedAt?: string },
  ): Promise<OtpRequestResult> {
    const phoneHash = this.phoneHash(phone);
    const cooldownKey = this.redis.key('otp', 'cooldown', purpose, phoneHash);
    const existingChallenge = await this.redis.get(cooldownKey);
    if (existingChallenge) {
      return { accepted: true, challengeId: existingChallenge };
    }

    const challengeId = randomUUID();
    if (!(await this.rateLimitAllows(phoneHash, ipHash))) {
      return { accepted: true, challengeId };
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const challenge: StoredOtpChallenge = {
      phoneHash,
      codeHash: keyedDigest(code, this.config.internalToken),
      purpose,
      attempts: 0,
      preferredLanguage: context?.preferredLanguage,
      consentAcceptedAt: context?.consentAcceptedAt,
    };
    await this.redis.set(
      this.redis.key('otp', 'challenge', challengeId),
      JSON.stringify(challenge),
      this.config.otpTtlSeconds,
    );
    await this.redis.set(
      cooldownKey,
      challengeId,
      this.config.otpResendCooldownSeconds,
    );

    const demoOtp = this.provider.exposeForDemo(code);
    return demoOtp
      ? { accepted: true, challengeId, demoOtp }
      : { accepted: true, challengeId };
  }

  async verify(
    phone: string,
    challengeId: string,
    otp: string,
    purpose: OtpPurpose,
  ): Promise<StoredOtpChallenge> {
    const key = this.redis.key('otp', 'challenge', challengeId);
    const rawChallenge = await this.redis.get(key);
    if (!rawChallenge) {
      throw new AuthError(
        'INVALID_OTP',
        'The one-time code is invalid or expired.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const challenge = JSON.parse(rawChallenge) as StoredOtpChallenge;
    const phoneMatches = timingSafeStringEqual(
      challenge.phoneHash,
      this.phoneHash(phone),
    );
    const codeMatches = timingSafeStringEqual(
      challenge.codeHash,
      keyedDigest(otp, this.config.internalToken),
    );

    if (!phoneMatches || challenge.purpose !== purpose || !codeMatches) {
      challenge.attempts += 1;
      if (challenge.attempts >= this.config.otpMaxAttempts) {
        await this.redis.delete(key);
      } else {
        await this.redis.setKeepingTtl(key, JSON.stringify(challenge));
      }
      throw new AuthError(
        'INVALID_OTP',
        'The one-time code is invalid or expired.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    await this.redis.delete(key);
    return challenge;
  }
}
