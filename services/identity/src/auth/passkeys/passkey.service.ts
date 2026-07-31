import type {
  PasskeyAuthenticationVerificationInput,
  PasskeyRegistrationVerificationInput,
} from '@aegis/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import {
  IDENTITY_CONFIG,
  type IdentityConfig,
} from '../../common/config/identity.config';
import { AuthError } from '../../common/errors/auth.error';
import { sha256, timingSafeStringEqual } from '../../common/security/security';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuthEventService } from '../events/auth-event.service';
import {
  SessionService,
  type CreatedSession,
} from '../sessions/session.service';
import { WebAuthnAdapter } from './webauthn.adapter';

interface StoredRegistrationChallenge {
  userId: string;
  sessionHash: string;
}

@Injectable()
export class PasskeyService {
  private readonly challengeTtlSeconds = 300;

  constructor(
    private readonly adapter: WebAuthnAdapter,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly events: AuthEventService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  async registrationOptions(
    sessionId: string,
    csrfToken: string,
  ): Promise<Record<string, unknown>> {
    const userId = await this.sessions.authorize(sessionId, csrfToken);
    const credentials = await this.prisma.client.passkeyCredential.findMany({
      where: { userId, revokedAt: null },
    });
    const options = await this.adapter.generateRegistration({
      rpName: this.config.webauthnRpName,
      rpID: this.config.webauthnRpId,
      userID: new Uint8Array(Buffer.from(userId, 'utf8')),
      userName: userId,
      userDisplayName: 'AEGIS user',
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
      excludeCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as AuthenticatorTransportFuture[],
      })),
    });
    await this.redis.set(
      this.redis.key('webauthn', 'registration', sha256(options.challenge)),
      JSON.stringify({ userId, sessionHash: sha256(sessionId) }),
      this.challengeTtlSeconds,
    );
    return options as unknown as Record<string, unknown>;
  }

  async verifyRegistration(
    sessionId: string,
    csrfToken: string,
    input: PasskeyRegistrationVerificationInput,
    correlationId: string,
  ): Promise<{ verified: true }> {
    const userId = await this.sessions.authorize(sessionId, csrfToken);
    const key = this.redis.key(
      'webauthn',
      'registration',
      sha256(input.challenge),
    );
    const rawChallenge = await this.redis.getDel(key);
    if (!rawChallenge) throw this.invalidPasskey();
    const challenge = JSON.parse(rawChallenge) as StoredRegistrationChallenge;
    if (
      challenge.userId !== userId ||
      !timingSafeStringEqual(challenge.sessionHash, sha256(sessionId))
    ) {
      throw this.invalidPasskey();
    }
    const verification = await this.adapter.verifyRegistration({
      response: input.credential as RegistrationResponseJSON,
      expectedChallenge: input.challenge,
      expectedOrigin: this.config.webauthnOrigin,
      expectedRPID: this.config.webauthnRpId,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw this.invalidPasskey();
    }
    const info = verification.registrationInfo;
    await this.prisma.client.passkeyCredential.create({
      data: {
        userId,
        credentialId: info.credential.id,
        publicKey: Buffer.from(info.credential.publicKey),
        counter: BigInt(info.credential.counter),
        transports: info.credential.transports ?? [],
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        nickname: input.nickname,
      },
    });
    await this.events.record({
      userId,
      eventType: 'PASSKEY_REGISTERED',
      outcome: 'SUCCESS',
      correlationId,
      metadata: { deviceType: info.credentialDeviceType },
    });
    return { verified: true };
  }

  async authenticationOptions(
    ipHash: string,
  ): Promise<Record<string, unknown>> {
    const rateCount = await this.redis.incrementWithTtl(
      this.redis.key('webauthn', 'rate', ipHash),
      3_600,
    );
    if (rateCount > 20) {
      throw new AuthError('RATE_LIMITED', 'Try again later.', 429);
    }
    const options = await this.adapter.generateAuthentication({
      rpID: this.config.webauthnRpId,
      userVerification: 'required',
      allowCredentials: [],
    });
    await this.redis.set(
      this.redis.key('webauthn', 'authentication', sha256(options.challenge)),
      JSON.stringify({ ipHash }),
      this.challengeTtlSeconds,
    );
    return options as unknown as Record<string, unknown>;
  }

  async verifyAuthentication(
    input: PasskeyAuthenticationVerificationInput,
    ipHash: string,
    correlationId: string,
  ): Promise<CreatedSession> {
    const key = this.redis.key(
      'webauthn',
      'authentication',
      sha256(input.challenge),
    );
    const rawChallenge = await this.redis.getDel(key);
    if (!rawChallenge) throw this.invalidPasskey();
    const stored = JSON.parse(rawChallenge) as { ipHash: string };
    if (!timingSafeStringEqual(stored.ipHash, ipHash)) {
      throw this.invalidPasskey();
    }
    const credential = await this.prisma.client.passkeyCredential.findUnique({
      where: { credentialId: input.credential.id },
    });
    if (!credential || credential.revokedAt) throw this.invalidPasskey();
    if (credential.counter > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw this.invalidPasskey();
    }
    const verification = await this.adapter.verifyAuthentication({
      response: input.credential as AuthenticationResponseJSON,
      expectedChallenge: input.challenge,
      expectedOrigin: this.config.webauthnOrigin,
      expectedRPID: this.config.webauthnRpId,
      requireUserVerification: true,
      credential: {
        id: credential.credentialId,
        publicKey: new Uint8Array(credential.publicKey),
        counter: Number(credential.counter),
        transports: credential.transports as AuthenticatorTransportFuture[],
      },
    });
    if (
      !verification.verified ||
      (credential.counter > 0n &&
        BigInt(verification.authenticationInfo.newCounter) < credential.counter)
    ) {
      throw this.invalidPasskey();
    }
    await this.prisma.client.passkeyCredential.update({
      where: { id: credential.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });
    await this.events.record({
      userId: credential.userId,
      eventType: 'PASSKEY_LOGIN_SUCCEEDED',
      outcome: 'SUCCESS',
      correlationId,
      ipHash,
      metadata: { userVerified: true },
    });
    return this.sessions.create(credential.userId, 'PASSKEY', input.deviceId);
  }

  private invalidPasskey(): AuthError {
    return new AuthError(
      'PASSKEY_FAILED',
      'Passkey verification could not be completed.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
