import type { IdentityConfig } from '../../common/config/identity.config';
import { sha256 } from '../../common/security/security';
import { PasskeyService } from './passkey.service';

class FakeRedis {
  values = new Map<string, string>();
  ttls = new Map<string, number>();
  key(...parts: string[]) {
    return `aegis:identity:test:passkey:${parts.join(':')}`;
  }
  set(key: string, value: string, ttl: number): Promise<void> {
    this.values.set(key, value);
    this.ttls.set(key, ttl);
    return Promise.resolve();
  }
  getDel(key: string): Promise<string | null> {
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return Promise.resolve(value);
  }
  incrementWithTtl(): Promise<number> {
    return Promise.resolve(1);
  }
}

const config = {
  webauthnRpName: 'AEGIS Shield Test',
  webauthnRpId: 'localhost',
  webauthnOrigin: 'http://localhost:3000',
} as IdentityConfig;

const authenticationInput = {
  challenge: 'test-authentication-challenge-value',
  credential: {
    id: 'credential-id',
    type: 'public-key',
    response: {
      clientDataJSON: 'client-data',
      authenticatorData: 'authenticator-data',
      signature: 'signature',
    },
  },
};

describe('PasskeyService', () => {
  function fixture() {
    const redis = new FakeRedis();
    const adapter = {
      generateRegistration: jest.fn((options: unknown) =>
        Promise.resolve({ challenge: 'registration-challenge', options }),
      ),
      verifyRegistration: jest.fn().mockResolvedValue({ verified: false }),
      generateAuthentication: jest.fn((options: unknown) =>
        Promise.resolve({ challenge: 'authentication-challenge', options }),
      ),
      verifyAuthentication: jest.fn().mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 5 },
      }),
    };
    const credential = {
      id: 'passkey-row',
      userId: 'user-id',
      credentialId: 'credential-id',
      publicKey: Buffer.from('public-key'),
      counter: 4n,
      transports: ['internal'],
      revokedAt: null,
    };
    const prisma = {
      client: {
        passkeyCredential: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn().mockResolvedValue(credential),
          create: jest.fn(),
          update: jest.fn((input: unknown) => Promise.resolve(input)),
        },
      },
    };
    const sessions = {
      authorize: jest.fn().mockResolvedValue('user-id'),
      create: jest.fn().mockResolvedValue({ sessionId: 'new-session' }),
    };
    const events = { record: jest.fn() };
    return {
      redis,
      adapter,
      prisma,
      sessions,
      events,
      credential,
      service: new PasskeyService(
        adapter as never,
        redis as never,
        prisma as never,
        sessions as never,
        events as never,
        config,
      ),
    };
  }

  it('stores registration and usernameless authentication challenges with TTLs', async () => {
    const { service, redis, adapter } = fixture();
    await service.registrationOptions('session-id', 'csrf-token');
    await service.authenticationOptions('ip-hash');

    const registrationCall: unknown =
      adapter.generateRegistration.mock.calls[0]?.[0];
    expect(registrationCall).toMatchObject({
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
    });
    expect(adapter.generateAuthentication).toHaveBeenCalledWith(
      expect.objectContaining({
        allowCredentials: [],
        userVerification: 'required',
      }),
    );
    expect([...redis.ttls.values()]).toEqual([300, 300]);
  });

  it('consumes a registration challenge before verification and rejects replay', async () => {
    const { service, redis, adapter } = fixture();
    const challenge = 'registration-challenge-value';
    redis.values.set(
      redis.key('webauthn', 'registration', sha256(challenge)),
      JSON.stringify({ userId: 'user-id', sessionHash: sha256('session-id') }),
    );
    const input = {
      challenge,
      credential: {
        id: 'credential-id',
        type: 'public-key',
        response: { clientDataJSON: 'data', attestationObject: 'object' },
      },
    };
    await expect(
      service.verifyRegistration(
        'session-id',
        'csrf-token',
        input as never,
        'correlation',
      ),
    ).rejects.toMatchObject({ code: 'PASSKEY_FAILED' });
    await expect(
      service.verifyRegistration(
        'session-id',
        'csrf-token',
        input as never,
        'correlation',
      ),
    ).rejects.toMatchObject({ code: 'PASSKEY_FAILED' });
    expect(adapter.verifyRegistration).toHaveBeenCalledTimes(1);
  });

  it('rejects a revoked credential and consumes the authentication challenge', async () => {
    const { service, redis, prisma, adapter, credential } = fixture();
    credential.revokedAt = new Date() as never;
    redis.values.set(
      redis.key(
        'webauthn',
        'authentication',
        sha256(authenticationInput.challenge),
      ),
      JSON.stringify({ ipHash: 'ip-hash' }),
    );
    await expect(
      service.verifyAuthentication(
        authenticationInput as never,
        'ip-hash',
        'correlation',
      ),
    ).rejects.toMatchObject({ code: 'PASSKEY_FAILED' });
    await expect(
      service.verifyAuthentication(
        authenticationInput as never,
        'ip-hash',
        'correlation',
      ),
    ).rejects.toMatchObject({ code: 'PASSKEY_FAILED' });
    expect(prisma.client.passkeyCredential.findUnique).toHaveBeenCalledTimes(1);
    expect(adapter.verifyAuthentication).not.toHaveBeenCalled();
  });

  it('updates the counter boundary and creates a new session after verification', async () => {
    const { service, redis, prisma, sessions } = fixture();
    redis.values.set(
      redis.key(
        'webauthn',
        'authentication',
        sha256(authenticationInput.challenge),
      ),
      JSON.stringify({ ipHash: 'ip-hash' }),
    );
    await expect(
      service.verifyAuthentication(
        authenticationInput as never,
        'ip-hash',
        'correlation',
      ),
    ).resolves.toEqual({ sessionId: 'new-session' });
    const updateCall: unknown =
      prisma.client.passkeyCredential.update.mock.calls[0]?.[0];
    expect(updateCall).toMatchObject({ data: { counter: 5n } });
    expect(sessions.create).toHaveBeenCalledWith(
      'user-id',
      'PASSKEY',
      undefined,
    );
  });

  it('rejects an unexpected authenticator counter regression', async () => {
    const { service, redis, adapter, prisma } = fixture();
    adapter.verifyAuthentication.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 3 },
    });
    redis.values.set(
      redis.key(
        'webauthn',
        'authentication',
        sha256(authenticationInput.challenge),
      ),
      JSON.stringify({ ipHash: 'ip-hash' }),
    );
    await expect(
      service.verifyAuthentication(
        authenticationInput as never,
        'ip-hash',
        'correlation',
      ),
    ).rejects.toMatchObject({ code: 'PASSKEY_FAILED' });
    expect(prisma.client.passkeyCredential.update).not.toHaveBeenCalled();
  });
});
