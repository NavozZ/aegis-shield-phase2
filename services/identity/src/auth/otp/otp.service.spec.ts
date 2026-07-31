import type { IdentityConfig } from '../../common/config/identity.config';
import { keyedDigest } from '../../common/security/security';
import { OtpService, type StoredOtpChallenge } from './otp.service';

class FakeRedis {
  readonly values = new Map<string, string>();
  readonly ttls = new Map<string, number>();
  readonly counters = new Map<string, number>();

  key(...parts: string[]): string {
    return `aegis:identity:test:${parts.join(':')}`;
  }
  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }
  set(key: string, value: string, ttl: number): Promise<void> {
    this.values.set(key, value);
    this.ttls.set(key, ttl);
    return Promise.resolve();
  }
  setKeepingTtl(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
  delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
  incrementWithTtl(key: string): Promise<number> {
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return Promise.resolve(next);
  }
}

const config = {
  internalToken: 'test-only-hmac-secret',
  otpTtlSeconds: 300,
  otpResendCooldownSeconds: 60,
  otpMaxAttempts: 3,
  otpRequestLimitPerHour: 5,
} as IdentityConfig;

describe('OtpService', () => {
  it('stores only a keyed OTP digest with TTL and returns the same challenge during cooldown', async () => {
    const redis = new FakeRedis();
    const provider = { exposeForDemo: jest.fn((code: string) => code) };
    const service = new OtpService(redis as never, config, provider);
    const first = await service.request(
      '+12025550101',
      'ONBOARDING',
      'ip-hash',
    );
    const key = redis.key('otp', 'challenge', first.challengeId);
    const stored = JSON.parse(redis.values.get(key)!) as StoredOtpChallenge;

    expect(first.demoOtp).toMatch(/^\d{6}$/u);
    expect(stored.codeHash).toBe(
      keyedDigest(first.demoOtp!, config.internalToken),
    );
    expect(JSON.stringify(stored)).not.toContain(first.demoOtp);
    expect(redis.ttls.get(key)).toBe(300);
    await expect(
      service.request('+12025550101', 'ONBOARDING', 'ip-hash'),
    ).resolves.toMatchObject({ challengeId: first.challengeId });
  });

  it('never exposes a demo OTP when the provider disables it', async () => {
    const service = new OtpService(new FakeRedis() as never, config, {
      exposeForDemo: () => undefined,
    });
    await expect(
      service.request('+12025550102', 'ONBOARDING', 'ip-hash'),
    ).resolves.not.toHaveProperty('demoOtp');
  });

  it('rejects invalid attempts, deletes after the maximum, and consumes a valid challenge', async () => {
    const redis = new FakeRedis();
    const service = new OtpService(redis as never, config, {
      exposeForDemo: (code: string) => code,
    });
    const first = await service.request('+12025550103', 'FALLBACK', 'ip-hash');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        service.verify('+12025550103', first.challengeId, '999999', 'FALLBACK'),
      ).rejects.toMatchObject({ code: 'INVALID_OTP' });
    }
    await expect(
      service.verify(
        '+12025550103',
        first.challengeId,
        first.demoOtp!,
        'FALLBACK',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_OTP' });

    const second = await service.request('+12025550104', 'FALLBACK', 'ip-2');
    await expect(
      service.verify(
        '+12025550104',
        second.challengeId,
        second.demoOtp!,
        'FALLBACK',
      ),
    ).resolves.toMatchObject({ purpose: 'FALLBACK' });
    await expect(
      service.verify(
        '+12025550104',
        second.challengeId,
        second.demoOtp!,
        'FALLBACK',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_OTP' });
  });
});
