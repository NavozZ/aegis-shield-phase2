import { z } from 'zod';

/*
 * SABCL operator status contract, v1.
 *
 * This is the boundary between the SABCL control plane and anything that
 * renders it. Every schema below is `.strict()`, which makes the contract a
 * privacy control rather than documentation: if a status endpoint ever started
 * returning a key, a route token or a decrypted payload, validation fails and
 * the consumer shows "unavailable" instead of displaying it.
 *
 * Key fields carry abbreviated fingerprints (`ledger.v2:9f3c1a`), never key
 * material. The length caps below are sized so a full 32-byte key cannot fit.
 */

/** `<service>.v<version>:<6 hex chars>` — identifies a key without publishing it. */
export const sabclKeyFingerprintSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(
    /^[a-z][a-z0-9-]*\.v[0-9]+(:[0-9a-f]{6})?$/u,
    'must be an abbreviated key',
  );

export const sabclRotationEntrySchema = z
  .object({
    service: z.string().min(1).max(64),
    /** The version senders should address now. Null when none is live. */
    active: sabclKeyFingerprintSchema.nullable(),
    /** Versions still accepted inbound, which is what makes rotation safe. */
    accepted: z.array(sabclKeyFingerprintSchema).max(16),
    revoked: z.array(sabclKeyFingerprintSchema).max(16),
  })
  .strict();

export const sabclRouteHealthSchema = z
  .object({
    /** Capability name, e.g. `ledger.accounts`. Never a destination URL. */
    routeId: z.string().min(3).max(64),
    service: z.string().min(1).max(64),
    reachable: z.boolean(),
  })
  .strict();

export const sabclRouterStatusSchema = z
  .object({
    protocolVersion: z.string().min(1).max(32),
    mode: z.enum(['strict', 'compatible', 'off']),
    strict: z.boolean(),
    routerKey: sabclKeyFingerprintSchema,
    rotation: z.array(sabclRotationEntrySchema).max(32),
    routes: z.array(z.string().min(3).max(64)).max(64),
    reachability: z.array(sabclRouteHealthSchema).max(64),
    padding: z
      .object({ policy: z.string().max(32), unit: z.string().max(16) })
      .strict(),
    counters: z.record(z.string().max(64), z.number().int().nonnegative()),
    replayState: z.enum(['ok', 'unavailable']),
  })
  .strict();

export const sabclStatusResponseSchema = z
  .object({
    protocolVersion: z.string().min(1).max(32),
    mode: z.enum(['strict', 'compatible', 'off']),
    strict: z.boolean(),
    gatewayKey: sabclKeyFingerprintSchema.nullable(),
    peerKeyIds: z.array(z.string().min(3).max(64)).max(32),
    routerReachable: z.boolean(),
    router: sabclRouterStatusSchema.nullable(),
  })
  .strict();

export type SabclRotationEntry = z.infer<typeof sabclRotationEntrySchema>;
export type SabclRouteHealth = z.infer<typeof sabclRouteHealthSchema>;
export type SabclRouterStatus = z.infer<typeof sabclRouterStatusSchema>;
export type SabclStatusResponse = z.infer<typeof sabclStatusResponseSchema>;
