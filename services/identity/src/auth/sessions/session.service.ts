import type { MaskedUser, SessionResponse } from '@aegis/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  IDENTITY_CONFIG,
  type IdentityConfig,
} from '../../common/config/identity.config';
import { AuthError } from '../../common/errors/auth.error';
import {
  maskDevice,
  maskPhone,
  sha256,
  timingSafeStringEqual,
} from '../../common/security/security';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';

export type AuthenticationMethod = 'PIN_OTP' | 'PASSKEY';

export interface StoredSession {
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  absoluteExpiresAt: string;
  csrfHash: string;
  authenticationMethod: AuthenticationMethod;
  device?: string;
  version: number;
}

export interface CreatedSession {
  sessionId: string;
  csrfToken: string;
  maxAgeSeconds: number;
  session: SessionResponse;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  private sessionKey(sessionId: string): string {
    return this.redis.key('session', sha256(sessionId));
  }

  private async safeUser(userId: string): Promise<MaskedUser> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new AuthError(
        'UNAUTHENTICATED',
        'Authentication is required.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return {
      id: user.id,
      phoneMasked: maskPhone(user.phoneE164),
      preferredLanguage: user.preferredLanguage,
      kycTier: user.kycTier,
      status: user.status,
      phoneVerified: Boolean(user.phoneVerifiedAt),
    };
  }

  async create(
    userId: string,
    authenticationMethod: AuthenticationMethod,
    deviceId?: string,
  ): Promise<CreatedSession> {
    const sessionId = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const now = new Date();
    const absoluteExpiresAt = new Date(
      now.getTime() + this.config.sessionAbsoluteTtlSeconds * 1_000,
    );
    const stored: StoredSession = {
      userId,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      absoluteExpiresAt: absoluteExpiresAt.toISOString(),
      csrfHash: sha256(csrfToken),
      authenticationMethod,
      device: maskDevice(deviceId),
      version: 1,
    };
    await this.redis.set(
      this.sessionKey(sessionId),
      JSON.stringify(stored),
      this.config.sessionIdleTtlSeconds,
    );

    return {
      sessionId,
      csrfToken,
      maxAgeSeconds: this.config.sessionAbsoluteTtlSeconds,
      session: {
        authenticated: true,
        authenticationMethod,
        expiresAt: absoluteExpiresAt.toISOString(),
        user: await this.safeUser(userId),
      },
    };
  }

  private async read(
    sessionId: string,
  ): Promise<{ key: string; value: StoredSession }> {
    const key = this.sessionKey(sessionId);
    const raw = await this.redis.get(key);
    if (!raw) {
      throw new AuthError(
        'UNAUTHENTICATED',
        'Authentication is required.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const value = JSON.parse(raw) as StoredSession;
    if (Date.parse(value.absoluteExpiresAt) <= Date.now()) {
      await this.redis.delete(key);
      throw new AuthError(
        'UNAUTHENTICATED',
        'Authentication is required.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return { key, value };
  }

  async get(sessionId: string): Promise<SessionResponse> {
    const { key, value } = await this.read(sessionId);
    const absoluteRemaining = Math.max(
      1,
      Math.floor((Date.parse(value.absoluteExpiresAt) - Date.now()) / 1_000),
    );
    value.lastSeenAt = new Date().toISOString();
    await this.redis.set(
      key,
      JSON.stringify(value),
      Math.min(this.config.sessionIdleTtlSeconds, absoluteRemaining),
    );
    return {
      authenticated: true,
      authenticationMethod: value.authenticationMethod,
      expiresAt: value.absoluteExpiresAt,
      user: await this.safeUser(value.userId),
    };
  }

  /** Reads session ownership without extending the idle or absolute lifetime. */
  async subject(sessionId: string): Promise<string> {
    return (await this.read(sessionId)).value.userId;
  }

  async requireCsrf(
    sessionId: string,
    csrfToken: string,
  ): Promise<StoredSession> {
    const { value } = await this.read(sessionId);
    if (!timingSafeStringEqual(value.csrfHash, sha256(csrfToken))) {
      throw new AuthError(
        'INVALID_CSRF',
        'The CSRF token is invalid.',
        HttpStatus.FORBIDDEN,
      );
    }
    return value;
  }

  async authorize(sessionId: string, csrfToken: string): Promise<string> {
    return (await this.requireCsrf(sessionId, csrfToken)).userId;
  }

  async revoke(sessionId: string, csrfToken: string): Promise<void> {
    await this.requireCsrf(sessionId, csrfToken);
    await this.redis.delete(this.sessionKey(sessionId));
  }

  async revokeTrusted(sessionId: string): Promise<string | null> {
    try {
      const userId = await this.subject(sessionId);
      await this.redis.delete(this.sessionKey(sessionId));
      return userId;
    } catch (error) {
      if (error instanceof AuthError && error.status === 401) return null;
      throw error;
    }
  }
}
