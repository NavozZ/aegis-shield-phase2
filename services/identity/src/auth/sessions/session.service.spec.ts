import type { IdentityConfig } from '../../common/config/identity.config';
import { SessionService } from './session.service';

class FakeRedis {
  values = new Map<string, string>();
  ttls = new Map<string, number>();
  key(...parts: string[]) {
    return `aegis:identity:test:${parts.join(':')}`;
  }
  set(key: string, value: string, ttl: number): Promise<void> {
    this.values.set(key, value);
    this.ttls.set(key, ttl);
    return Promise.resolve();
  }
  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }
  delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

const user = {
  id: 'c69d7343-36ba-4c89-91b6-38087feaf997',
  phoneE164: '+12025550110',
  preferredLanguage: 'EN',
  kycTier: 0,
  status: 'ACTIVE',
  phoneVerifiedAt: new Date(),
};

describe('SessionService', () => {
  it('creates random opaque values, enforces CSRF, refreshes idle TTL, and revokes', async () => {
    const redis = new FakeRedis();
    const prisma = {
      client: { user: { findUnique: jest.fn().mockResolvedValue(user) } },
    };
    const config = {
      sessionIdleTtlSeconds: 900,
      sessionAbsoluteTtlSeconds: 28_800,
    } as IdentityConfig;
    const service = new SessionService(redis as never, prisma as never, config);
    const first = await service.create(user.id, 'PIN_OTP', 'test-device');
    const second = await service.create(user.id, 'PIN_OTP', 'test-device');

    expect(first.sessionId).toHaveLength(43);
    expect(first.csrfToken).toHaveLength(43);
    expect(first.sessionId).not.toBe(second.sessionId);
    expect(first.csrfToken).not.toBe(second.csrfToken);
    expect([...redis.values.values()].join(' ')).not.toContain(first.sessionId);
    await expect(
      service.requireCsrf(first.sessionId, 'wrong'),
    ).rejects.toMatchObject({
      code: 'INVALID_CSRF',
    });
    await expect(service.get(first.sessionId)).resolves.toMatchObject({
      authenticated: true,
      user: { phoneMasked: '+12******110' },
    });
    expect([...redis.ttls.values()]).toContain(900);
    await service.revoke(first.sessionId, first.csrfToken);
    await expect(service.get(first.sessionId)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects a session past its absolute expiry even if its key exists', async () => {
    const redis = new FakeRedis();
    const prisma = {
      client: { user: { findUnique: jest.fn().mockResolvedValue(user) } },
    };
    const service = new SessionService(
      redis as never,
      prisma as never,
      {
        sessionIdleTtlSeconds: 10,
        sessionAbsoluteTtlSeconds: 20,
      } as IdentityConfig,
    );
    const created = await service.create(user.id, 'PIN_OTP');
    const [key, raw] = [...redis.values.entries()].find(([candidate]) =>
      candidate.includes('session:'),
    )!;
    const stored = JSON.parse(raw) as { absoluteExpiresAt: string };
    stored.absoluteExpiresAt = new Date(Date.now() - 1).toISOString();
    redis.values.set(key, JSON.stringify(stored));
    await expect(service.get(created.sessionId)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});
