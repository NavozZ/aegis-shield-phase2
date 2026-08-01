/*
 * Rate-limit bucket classification.
 *
 * The previous rule was `path.split('/').filter(Boolean)[2]`, which had two
 * problems.
 *
 * 1. Every authentication route shared one bucket. `/api/v1/auth/session` — which
 *    the web app calls on every protected page render — competed for the same
 *    120 requests per minute as onboarding, fallback sign-in and passkeys. A
 *    browser journey that navigated a few pages could exhaust the budget, and a
 *    later onboarding in the same suite would receive 429 instead of an OTP
 *    step. That is what broke the transfer browser journey: the field labelled
 *    "Six-digit verification code" never rendered because the request behind it
 *    had been rate-limited.
 *
 * 2. The bucket name came from the path, so `/api/v1/<anything>/x` minted a new
 *    bucket with a fresh budget. An attacker could both evade the limit and
 *    churn the window map by varying a path segment.
 *
 * Both are fixed by classifying against an explicit allowlist. An unrecognised
 * path does not get its own bucket; it falls into a restrictive shared one.
 *
 * Splitting the families does not relax anything: every authentication family
 * has a limit at or below the previous shared 120, and the credential-bearing
 * families are now stricter than before. Only `session`, a read-only check that
 * carries no credentials, keeps the old ceiling.
 */

export interface RateLimitBucket {
  /** Stable bucket name. Never derived from unvalidated request input. */
  name: string;
  /** Requests permitted per window for this bucket. */
  limit: number;
}

/** One minute, matching the previous behaviour. */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Applies to any route that is not classified below. Unchanged from before. */
export const DEFAULT_LIMIT = 120;

/**
 * Authentication route families, keyed by the path segment after
 * `/api/v1/auth/`. Adding a family here is a deliberate decision; a route that
 * is not listed is treated as unknown and gets the restrictive fallback.
 */
const AUTH_FAMILIES: Record<string, number> = {
  // Read-only session check with no credentials. This is the high-frequency
  // caller — every protected page render makes one — and the reason the shared
  // bucket used to run dry.
  session: 120,
  // OTP request, OTP verification and PIN creation. Identity independently
  // enforces OTP_REQUEST_LIMIT_PER_HOUR and OTP_MAX_ATTEMPTS, so this is a
  // flood brake in front of those, not the only control.
  onboarding: 60,
  // Sign-in with PIN and OTP: the credential-stuffing surface. Deliberately the
  // strictest family, and stricter than the 120 it previously shared.
  fallback: 40,
  passkeys: 60,
  logout: 60,
};

/** Unknown authentication routes. Restrictive by design. */
export const UNKNOWN_AUTH_LIMIT = 20;

/**
 * Top-level API segments that own a bucket. Anything outside this list shares
 * one restrictive bucket rather than minting its own.
 */
const KNOWN_SEGMENTS = new Set([
  'auth',
  'accounts',
  'transfers',
  'channels',
  'security-ops',
  'sabcl',
]);

/** Unrecognised top-level segments share this one bucket. */
export const UNKNOWN_SEGMENT_BUCKET = 'unclassified';
export const UNKNOWN_SEGMENT_LIMIT = 20;

/**
 * Classifies a request path into a bucket.
 *
 * Returns a name drawn only from the constants above, so the set of possible
 * bucket names is finite and known at build time regardless of what a caller
 * sends.
 */
export function classifyRateLimitBucket(path: string): RateLimitBucket {
  const segments = path.split('/').filter(Boolean);
  const segment = segments[2];

  if (segment === undefined || !KNOWN_SEGMENTS.has(segment)) {
    return { name: UNKNOWN_SEGMENT_BUCKET, limit: UNKNOWN_SEGMENT_LIMIT };
  }

  if (segment !== 'auth') {
    // Non-authentication routes keep their previous behaviour exactly.
    return { name: segment, limit: DEFAULT_LIMIT };
  }

  const family = segments[3];
  if (family !== undefined && Object.hasOwn(AUTH_FAMILIES, family)) {
    return { name: `auth:${family}`, limit: AUTH_FAMILIES[family] };
  }
  // A route under /api/v1/auth that is not a known family. Restrictive, and
  // shared, so an attacker cannot create budget by inventing sub-paths.
  return { name: 'auth:unclassified', limit: UNKNOWN_AUTH_LIMIT };
}
