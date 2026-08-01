import { z } from 'zod';
import {
  SABCL_MAX_ENVELOPE_BYTES,
  SABCL_MAX_HOP_LIMIT,
  SABCL_PROTOCOL_VERSION,
} from './version.js';
import { canonicalEncode, canonicalUInt } from './canonical.js';

/*
 * THE OUTER ENVELOPE IS THE PRIVACY BOUNDARY.
 *
 * Everything in `sabclEnvelopeSchema` is visible to the blind router. Adding a
 * field here means adding it to the router's view of the traffic, so the rule
 * is: an outer field must be either opaque (random or HMAC-derived) or purely
 * structural (version, time, size). No endpoint path, no operation name, no
 * customer, account, amount or recipient reference may appear — those live only
 * inside `ct`, which the router has no key for.
 *
 * `packages/sabcl/src/protocol/leakage.test.ts` enforces this against seeded
 * sensitive values, and `sabclEnvelopeSchema` is `.strict()` so an unexpected
 * field is a parse failure rather than a silent leak.
 */

const base64Url = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/u, 'must be base64url');

/** Padding buckets, in bytes. A message is padded up to the smallest bucket that fits. */
export const SABCL_PADDING_BUCKETS = [
  512, 1_024, 2_048, 4_096, 8_192, 16_384, 32_768, 65_536,
] as const;

export const sabclEnvelopeSchema = z
  .object({
    /** Protocol version. */
    v: z.literal(SABCL_PROTOCOL_VERSION),
    /** Opaque 128-bit message identifier. Replay key and response correlator. */
    mid: base64Url(32),
    /** Opaque route token. HMAC-derived; not reversible to a service name. */
    rt: base64Url(64),
    /** Sender key identifier, e.g. `gateway.v1`. Names a key, not a customer. */
    skid: z
      .string()
      .min(3)
      .max(64)
      .regex(/^[a-z][a-z0-9-]*\.v[0-9]+$/u, 'must be <service>.v<version>'),
    /** Recipient key identifier. */
    rkid: z
      .string()
      .min(3)
      .max(64)
      .regex(/^[a-z][a-z0-9-]*\.v[0-9]+$/u, 'must be <service>.v<version>'),
    /** Sender's ephemeral X25519 public key for this message only. */
    epk: base64Url(64),
    /** Creation time, unix seconds. */
    iat: z.number().int().nonnegative(),
    /** Expiry, unix seconds. */
    exp: z.number().int().nonnegative(),
    /** AES-GCM nonce, 96 bits. */
    n: base64Url(24),
    /** Remaining hops. Decremented by each forwarding element. */
    hl: z.number().int().min(0).max(SABCL_MAX_HOP_LIMIT),
    /** Padded plaintext length in bytes; always one of SABCL_PADDING_BUCKETS. */
    pad: z.number().int().positive(),
    /** AES-256-GCM ciphertext of the padded payload. */
    ct: base64Url(SABCL_MAX_ENVELOPE_BYTES),
    /** AES-256-GCM authentication tag. */
    tag: base64Url(32),
    /** Ed25519 signature by the sender's signing key. */
    sig: base64Url(128),
  })
  .strict();

export type SabclEnvelope = z.infer<typeof sabclEnvelopeSchema>;

/**
 * Response envelope.
 *
 * Deliberately narrower than the request: a response is returned on the
 * connection the request arrived on, so it needs no route token and no hop
 * limit. `cid` binds the response to the request's `mid` — an opaque value the
 * router already saw, so correlation costs no additional metadata.
 */
export const sabclResponseEnvelopeSchema = z
  .object({
    v: z.literal(SABCL_PROTOCOL_VERSION),
    /** Correlates to the request `mid`. Opaque; never a business identifier. */
    cid: base64Url(32),
    /** Responder key identifier. */
    skid: z
      .string()
      .min(3)
      .max(64)
      .regex(/^[a-z][a-z0-9-]*\.v[0-9]+$/u, 'must be <service>.v<version>'),
    n: base64Url(24),
    pad: z.number().int().positive(),
    ct: base64Url(SABCL_MAX_ENVELOPE_BYTES),
    tag: base64Url(32),
    sig: base64Url(128),
  })
  .strict();

export type SabclResponseEnvelope = z.infer<typeof sabclResponseEnvelopeSchema>;

/** The signed and authenticated header of a request, in fixed field order. */
export function canonicalRequestHeader(
  envelope: Omit<SabclEnvelope, 'ct' | 'tag' | 'sig'>,
): Buffer {
  return canonicalEncode([
    envelope.v,
    envelope.mid,
    envelope.rt,
    envelope.skid,
    envelope.rkid,
    envelope.epk,
    canonicalUInt(envelope.iat),
    canonicalUInt(envelope.exp),
    envelope.n,
    canonicalUInt(envelope.hl),
    canonicalUInt(envelope.pad),
  ]);
}

/** The signed and authenticated header of a response, in fixed field order. */
export function canonicalResponseHeader(
  envelope: Omit<SabclResponseEnvelope, 'ct' | 'tag' | 'sig'>,
): Buffer {
  return canonicalEncode([
    envelope.v,
    envelope.cid,
    envelope.skid,
    envelope.n,
    canonicalUInt(envelope.pad),
  ]);
}

/**
 * Smallest padding bucket that holds `length` bytes.
 *
 * Padding hides exact payload size, not the order of magnitude: a caller that
 * sends a 40 KB message is still distinguishable from one that sends 200 bytes.
 * The buckets are documented in `docs/security/sabcl-metadata-leakage.md`.
 */
export function paddingBucketFor(length: number): number {
  const bucket = SABCL_PADDING_BUCKETS.find((size) => length <= size);
  if (bucket === undefined) {
    throw new RangeError('Payload exceeds the largest SABCL padding bucket.');
  }
  return bucket;
}

/**
 * The hop limit a forwarding element should stamp on the message it emits.
 * Returns null when the message has exhausted its budget.
 */
export function decrementHopLimit(hopLimit: number): number | null {
  return hopLimit <= 0 ? null : hopLimit - 1;
}
