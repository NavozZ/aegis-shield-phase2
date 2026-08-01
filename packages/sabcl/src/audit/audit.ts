import { createHash } from 'node:crypto';
import type { SabclErrorCode } from '../protocol/errors.js';
import { SABCL_DOMAIN } from '../protocol/version.js';

/*
 * Privacy-safe operational events.
 *
 * The router has to be observable — an operator needs to see replay attempts
 * and signature failures — but an audit trail that records what it rejected is
 * a second copy of the metadata SABCL exists to suppress. So:
 *
 *   - no decrypted payload, ever;
 *   - message and route identifiers are stored as truncated salted digests, so
 *     an operator can correlate two log lines about the same message without
 *     the log itself being a lookup table back to the wire value;
 *   - service names are recorded in clear, because the router necessarily knows
 *     them and they are not customer data.
 */

export const SABCL_AUDIT_EVENTS = [
  'envelope.accepted',
  'envelope.rejected',
  'envelope.replayed',
  'envelope.expired',
  'signature.invalid',
  'route.invalid',
  'recipient.unavailable',
  'hop.exhausted',
  'key.rotation.used',
] as const;

export type SabclAuditEvent = (typeof SABCL_AUDIT_EVENTS)[number];

export interface SabclAuditRecord {
  event: SabclAuditEvent;
  /** Truncated salted digest of the message identifier. */
  messageDigest: string;
  /** Truncated salted digest of the route token. */
  routeDigest?: string;
  /** Key identifier, e.g. `gateway.v1`. Names a key, never a customer. */
  senderKeyId?: string;
  /** Protocol-layer reason. Never a business reason. */
  reason?: SabclErrorCode;
  /** Milliseconds spent forwarding, for outage diagnosis. */
  durationMs?: number;
  at: string;
}

/**
 * Salted, truncated digest for correlating log lines.
 *
 * The salt is the router's route secret, so digests are stable within a
 * deployment and meaningless outside it. Truncation to 12 hex characters keeps
 * the log readable; collisions are irrelevant because these values are only
 * ever compared, never resolved.
 */
export function auditDigest(salt: Buffer, value: string): string {
  return createHash('sha256')
    .update(salt)
    .update(`${SABCL_DOMAIN.serviceHandle}|${value}`, 'utf8')
    .digest('hex')
    .slice(0, 12);
}

/** Counters backing the operator status surface. */
export class SabclAuditCounters {
  private readonly counts = new Map<SabclAuditEvent, number>();

  record(event: SabclAuditEvent): void {
    this.counts.set(event, (this.counts.get(event) ?? 0) + 1);
  }

  snapshot(): Record<SabclAuditEvent, number> {
    const result = {} as Record<SabclAuditEvent, number>;
    for (const event of SABCL_AUDIT_EVENTS) {
      result[event] = this.counts.get(event) ?? 0;
    }
    return result;
  }
}
