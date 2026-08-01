import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  IDENTITY_CONFIG,
  type IdentityConfig,
} from '../../common/config/identity.config';
import { AuthError } from '../../common/errors/auth.error';
import { sha256 } from '../../common/security/security';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuthEventService } from '../events/auth-event.service';
import { PinService } from '../pin/pin.service';
import { SessionService } from '../sessions/session.service';
@Injectable()
export class TransferStepUpService {
  constructor(
    private readonly sessions: SessionService,
    private readonly pins: PinService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly events: AuthEventService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}
  private attempts(userId: string) {
    return this.redis.key('transfer-step-up', sha256(userId));
  }
  private lock(userId: string) {
    return this.redis.key('transfer-step-up-lock', sha256(userId));
  }
  async verify(
    sessionId: string,
    pin: string,
    context: { correlationId: string; ipHash?: string; userAgent?: string },
  ): Promise<{ verified: true }> {
    const userId = await this.sessions.subject(sessionId);
    if (await this.redis.get(this.lock(userId))) {
      await this.events.record({
        userId,
        eventType: 'TRANSFER_STEP_UP',
        outcome: 'LOCKED',
        correlationId: context.correlationId,
        ipHash: context.ipHash,
        userAgent: context.userAgent,
      });
      throw new AuthError(
        'TRANSFER_STEP_UP_LOCKED',
        'Authorization is unavailable.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      include: { pinCredential: true },
    });
    const valid = Boolean(
      user?.status === 'ACTIVE' &&
      user.pinCredential &&
      (await this.pins.verifyPin(user.pinCredential.pinHash, pin)),
    );
    if (!valid) {
      await this.pins.performDummyVerification(pin);
      const count = await this.redis.incrementWithTtl(
        this.attempts(userId),
        this.config.transferStepUpLockSeconds,
      );
      if (count >= this.config.transferStepUpMaxAttempts)
        await this.redis.set(
          this.lock(userId),
          '1',
          this.config.transferStepUpLockSeconds,
        );
      await this.events.record({
        userId,
        eventType: 'TRANSFER_STEP_UP',
        outcome:
          count >= this.config.transferStepUpMaxAttempts ? 'LOCKED' : 'FAILURE',
        correlationId: context.correlationId,
        ipHash: context.ipHash,
        userAgent: context.userAgent,
      });
      throw new AuthError(
        'TRANSFER_STEP_UP_FAILED',
        'Authorization failed.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    await this.redis.delete(this.attempts(userId));
    await this.events.record({
      userId,
      eventType: 'TRANSFER_STEP_UP',
      outcome: 'SUCCESS',
      correlationId: context.correlationId,
      ipHash: context.ipHash,
      userAgent: context.userAgent,
    });
    return { verified: true };
  }
}
