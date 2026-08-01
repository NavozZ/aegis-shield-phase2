import { z } from 'zod';

/*
 * The inner payload — everything below is encrypted.
 *
 * This is where the operation name, the concrete internal path, the actor and
 * the business body live. None of it is visible to the router; the router sees
 * only the opaque route token that selected the destination.
 *
 * The recipient still does not trust `path`. A route token authorises a
 * *capability*, and each capability declares a small set of path patterns it may
 * reach (see `SabclCapability` in the recipient adapter). A sender that holds a
 * valid key and a valid route token for `ledger.accounts` therefore still
 * cannot reach `/internal/customer-transfers` — the recipient rejects the path
 * before dispatching. Without that check the recipient would be a
 * confused-deputy proxy for anyone holding any route token.
 */

export const sabclInnerRequestSchema = z
  .object({
    /** Capability operation, for audit and for selecting the path allowlist. */
    op: z
      .string()
      .min(3)
      .max(64)
      .regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/u),
    method: z.enum(['GET', 'POST']),
    /** Concrete internal path, including query string. Allowlisted on receipt. */
    path: z.string().min(1).max(2_048).startsWith('/'),
    body: z.unknown().optional(),
    /**
     * Actor context the recipient would otherwise read from a header.
     * Sensitive: this is the customer identifier, and it is encrypted here
     * precisely so it never appears in routing metadata.
     */
    actor: z
      .object({ customerId: z.string().min(1).max(128).optional() })
      .strict()
      .optional(),
    /** Correlation identifier for logs. Opaque request-scoped value. */
    correlationId: z.string().min(1).max(128),
  })
  .strict();

export type SabclInnerRequest = z.infer<typeof sabclInnerRequestSchema>;

export const sabclInnerResponseSchema = z
  .object({
    status: z.number().int().min(100).max(599),
    body: z.unknown().optional(),
  })
  .strict();

export type SabclInnerResponse = z.infer<typeof sabclInnerResponseSchema>;
