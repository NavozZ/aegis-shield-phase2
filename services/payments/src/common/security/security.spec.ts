import {
  canonicalHash,
  newIntentToken,
  newTransferReference,
  sha256,
  timingSafeStringEqual,
} from './security';

describe('Payments security primitives', () => {
  it('creates a 256-bit base64url intent token', () => {
    const token = newIntentToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });
  it('creates distinct opaque intent tokens', () => {
    expect(newIntentToken()).not.toBe(newIntentToken());
  });
  it('stores token material through SHA-256', () => {
    expect(sha256('intent')).toMatch(/^[a-f0-9]{64}$/u);
    expect(sha256('intent')).not.toBe('intent');
  });
  it('creates safe display references without identifiers', () => {
    expect(newTransferReference()).toMatch(
      /^AEGIS-TRF-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/u,
    );
  });
  it('canonicalizes object ordering for idempotency request hashing', () => {
    expect(canonicalHash({ amount: '100', sender: 'a' })).toBe(
      canonicalHash({ sender: 'a', amount: '100' }),
    );
  });
  it('keeps distinct payment requests distinct', () => {
    expect(canonicalHash({ amount: '100' })).not.toBe(
      canonicalHash({ amount: '101' }),
    );
  });
  it('compares internal tokens without accepting empty or mismatched values', () => {
    expect(timingSafeStringEqual('token', 'token')).toBe(true);
    expect(timingSafeStringEqual('token', 'other')).toBe(false);
    expect(timingSafeStringEqual('', '')).toBe(false);
  });
});
