import {
  classifyRateLimitBucket,
  DEFAULT_LIMIT,
  UNKNOWN_AUTH_LIMIT,
  UNKNOWN_SEGMENT_BUCKET,
  UNKNOWN_SEGMENT_LIMIT,
} from './rate-limit-buckets';

/*
 * Bucket classification.
 *
 * Two properties matter here, and they pull in opposite directions:
 *
 *   - Distinct authentication families must not share a budget, or a
 *     high-frequency benign call starves a low-frequency important one. That is
 *     what broke the transfer browser journey.
 *   - The set of bucket names must stay finite and known, or a caller can mint
 *     unlimited budget by varying a path segment.
 *
 * An allowlist satisfies both. These tests pin each half.
 */

describe('classifyRateLimitBucket', () => {
  it('separates each authentication family into its own bucket', () => {
    const names = [
      '/api/v1/auth/session',
      '/api/v1/auth/onboarding/request-otp',
      '/api/v1/auth/fallback/login',
      '/api/v1/auth/passkeys/registration/options',
      '/api/v1/auth/logout',
    ].map((path) => classifyRateLimitBucket(path).name);

    expect(names).toEqual([
      'auth:session',
      'auth:onboarding',
      'auth:fallback',
      'auth:passkeys',
      'auth:logout',
    ]);
    // All distinct: no family can consume another's budget.
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps every route in a family in that family', () => {
    for (const path of [
      '/api/v1/auth/onboarding/request-otp',
      '/api/v1/auth/onboarding/verify-otp',
      '/api/v1/auth/onboarding/create-pin',
    ]) {
      expect(classifyRateLimitBucket(path).name).toBe('auth:onboarding');
    }
    for (const path of [
      '/api/v1/auth/fallback/request-otp',
      '/api/v1/auth/fallback/login',
    ]) {
      expect(classifyRateLimitBucket(path).name).toBe('auth:fallback');
    }
  });

  it('does not let onboarding and session checks consume each other budget', () => {
    const session = classifyRateLimitBucket('/api/v1/auth/session');
    const onboarding = classifyRateLimitBucket(
      '/api/v1/auth/onboarding/request-otp',
    );
    expect(session.name).not.toBe(onboarding.name);
  });

  it('never derives a bucket name from a path parameter', () => {
    // The old rule took the bucket straight from the path, so each of these
    // would have been its own bucket with its own fresh budget.
    const names = [
      '/api/v1/auth/aaaaaaaa',
      '/api/v1/auth/bbbbbbbb',
      '/api/v1/auth/cccccccc/dddddddd',
      '/api/v1/auth/11111111-1111-4111-8111-111111111111',
    ].map((path) => classifyRateLimitBucket(path).name);

    expect(new Set(names)).toEqual(new Set(['auth:unclassified']));
  });

  it('produces only names from the finite allowlist, whatever the input', () => {
    // The real guarantee: no input can grow the set of bucket names. A path
    // that happens to start with a known family still lands in that family's
    // bucket, which is safe — what must never happen is a *new* bucket.
    const permitted = new Set([
      'auth:session',
      'auth:onboarding',
      'auth:fallback',
      'auth:passkeys',
      'auth:logout',
      'auth:unclassified',
      'accounts',
      'transfers',
      'channels',
      'security-ops',
      'sabcl',
      UNKNOWN_SEGMENT_BUCKET,
    ]);

    const hostile = [
      '/api/v1/auth/onboarding/../../evil',
      '/api/v1/auth/onboarding%2f..%2fadmin',
      '/api/v1/auth/session/../../../etc/passwd',
      '//////',
      '/api/v1//',
      `/api/v1/auth/${'x'.repeat(5_000)}`,
      '/api/v1/AUTH/session',
      '/api/v2/auth/session',
      '',
    ];
    for (const path of hostile) {
      const bucket = classifyRateLimitBucket(path);
      expect(permitted.has(bucket.name)).toBe(true);
      expect(bucket.limit).toBeGreaterThan(0);
      expect(bucket.limit).toBeLessThanOrEqual(DEFAULT_LIMIT);
    }
  });

  it('gives unknown authentication routes a restrictive shared bucket', () => {
    const bucket = classifyRateLimitBucket('/api/v1/auth/some-new-flow');
    expect(bucket.name).toBe('auth:unclassified');
    expect(bucket.limit).toBe(UNKNOWN_AUTH_LIMIT);
    expect(bucket.limit).toBeLessThan(DEFAULT_LIMIT);
  });

  it('gives unknown top-level segments one restrictive shared bucket', () => {
    const names = [
      '/api/v1/not-a-real-segment/x',
      '/api/v1/another-invented-one',
      '/api/v1/'.concat('z'.repeat(200)),
      '/',
      '/health',
    ].map((path) => classifyRateLimitBucket(path).name);

    expect(new Set(names)).toEqual(new Set([UNKNOWN_SEGMENT_BUCKET]));
    expect(classifyRateLimitBucket('/api/v1/invented').limit).toBe(
      UNKNOWN_SEGMENT_LIMIT,
    );
  });

  it('leaves non-authentication routes exactly as they were', () => {
    for (const [path, name] of [
      ['/api/v1/accounts/one', 'accounts'],
      ['/api/v1/transfers/confirm', 'transfers'],
      ['/api/v1/channels/qr', 'channels'],
      ['/api/v1/security-ops/events', 'security-ops'],
      ['/api/v1/sabcl/status', 'sabcl'],
    ] as const) {
      const bucket = classifyRateLimitBucket(path);
      expect(bucket.name).toBe(name);
      expect(bucket.limit).toBe(DEFAULT_LIMIT);
    }
  });

  it('never relaxes an authentication limit above the previous shared ceiling', () => {
    // Splitting buckets must not become a way to raise limits. Every
    // authentication family is at or below the 120 they all used to share, and
    // the credential-bearing ones are stricter.
    for (const path of [
      '/api/v1/auth/session',
      '/api/v1/auth/onboarding/request-otp',
      '/api/v1/auth/fallback/login',
      '/api/v1/auth/passkeys/registration/options',
      '/api/v1/auth/logout',
      '/api/v1/auth/unknown',
    ]) {
      expect(classifyRateLimitBucket(path).limit).toBeLessThanOrEqual(
        DEFAULT_LIMIT,
      );
    }
    // Sign-in is the credential-stuffing surface and is the strictest family.
    expect(
      classifyRateLimitBucket('/api/v1/auth/fallback/login').limit,
    ).toBeLessThan(classifyRateLimitBucket('/api/v1/auth/session').limit);
  });
});
