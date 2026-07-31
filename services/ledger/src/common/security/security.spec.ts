import {
  advisoryLockKey,
  canonicalJson,
  canonicalRequestHash,
  idempotencyFingerprint,
  sha256,
  timingSafeStringEqual,
} from './security';

describe('ledger security helpers', () => {
  it('hashes deterministically', () => {
    expect(sha256('aegis')).toBe(sha256('aegis'));
    expect(sha256('aegis')).toHaveLength(64);
  });

  it('compares equal-length strings safely and rejects empty input', () => {
    expect(timingSafeStringEqual('token', 'token')).toBe(true);
    expect(timingSafeStringEqual('token', 'other')).toBe(false);
    expect(timingSafeStringEqual('token', 'tokenlonger')).toBe(false);
    expect(timingSafeStringEqual('', '')).toBe(false);
  });

  it('canonicalises objects so key order cannot change the hash', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalRequestHash({ a: 1, b: [1, 2] })).toBe(
      canonicalRequestHash({ b: [1, 2], a: 1 }),
    );
  });

  it('treats a different payload as a different request', () => {
    expect(canonicalRequestHash({ amount: '100' })).not.toBe(
      canonicalRequestHash({ amount: '101' }),
    );
  });

  it('distinguishes array order, which is significant', () => {
    expect(canonicalRequestHash([1, 2])).not.toBe(canonicalRequestHash([2, 1]));
  });

  it('omits undefined values so optional fields hash consistently', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('never reveals the idempotency key in its log fingerprint', () => {
    const key = 'provision-account-0123456789abcdef';
    const fingerprint = idempotencyFingerprint(key);
    expect(fingerprint).toMatch(/^idem:[a-f0-9]{12}$/u);
    expect(fingerprint).not.toContain(key);
    expect(idempotencyFingerprint(key)).toBe(fingerprint);
  });

  it('derives a stable signed 64-bit advisory lock key', () => {
    const key = advisoryLockKey('customer-account:abc:TIER0_WALLET:LKR');
    expect(typeof key).toBe('bigint');
    expect(key).toBe(advisoryLockKey('customer-account:abc:TIER0_WALLET:LKR'));
    expect(key).not.toBe(
      advisoryLockKey('customer-account:xyz:TIER0_WALLET:LKR'),
    );
    expect(key >= -(2n ** 63n) && key < 2n ** 63n).toBe(true);
  });
});
