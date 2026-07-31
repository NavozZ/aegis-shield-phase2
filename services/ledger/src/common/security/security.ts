import { createHash, timingSafeEqual } from 'node:crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length || leftBuffer.length === 0) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Produces a stable JSON encoding so that the same logical request always
 * hashes identically regardless of key order. Used only for idempotency
 * comparison; the raw payload is never stored.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${canonicalJson(entryValue)}`,
    );
  return `{${entries.join(',')}}`;
}

export function canonicalRequestHash(value: unknown): string {
  return sha256(canonicalJson(value));
}

/**
 * Idempotency keys are secrets supplied by callers. Only a short, non-reversible
 * fingerprint is ever logged so that a log leak cannot be used to replay a
 * request.
 */
export function idempotencyFingerprint(key: string): string {
  return `idem:${sha256(key).slice(0, 12)}`;
}

/**
 * Derives a stable signed 64-bit key for `pg_advisory_xact_lock`. Serialising
 * on a logical name lets concurrent provisioning of the same customer account
 * be ordered without depending on which unique constraint happens to fire.
 */
export function advisoryLockKey(value: string): bigint {
  return BigInt.asIntN(64, BigInt(`0x${sha256(value).slice(0, 16)}`));
}
