import type { SabclCapability } from '../server/sabcl-recipient.js';

/*
 * THE CAPABILITY CATALOGUE.
 *
 * One definition of what may be reached through SABCL, shared by the senders
 * (which pick a route) and the recipients (which enforce a path allowlist).
 * Keeping both sides on the same constant is the point: a route the gateway can
 * address but the recipient does not allow would fail in production and pass in
 * a unit test that mocked one side.
 *
 * Adding a path here widens what a route token authorises. Each pattern is
 * anchored at both ends and the identifier segments are constrained, so a
 * pattern cannot be satisfied by a traversal or an injected query.
 */

/** Identifier segments: UUIDs, opaque tokens and references, nothing with a slash. */
const ID = '[A-Za-z0-9_-]{1,128}';
/** An optional query string with no path separators in it. */
const QUERY = '(?:\\?[A-Za-z0-9_=&%.,:-]{0,512})?';

export const SABCL_CAPABILITIES = {
  /** Session and transfer step-up verification, owned by Identity. */
  'identity.step-up': {
    routeId: 'identity.step-up',
    service: 'identity',
    capability: {
      operationPrefix: 'identity.step-up',
      methods: ['GET', 'POST'],
      pathPatterns: [
        /^\/api\/v1\/auth\/transfer-step-up$/u,
        /^\/api\/v1\/auth\/session$/u,
      ],
    },
  },
  /** Account and transaction reads, owned by Ledger. */
  'ledger.accounts': {
    routeId: 'ledger.accounts',
    service: 'ledger',
    capability: {
      operationPrefix: 'ledger.accounts',
      methods: ['GET', 'POST'],
      pathPatterns: [
        /^\/internal\/customer-accounts\/default$/u,
        new RegExp(`^/internal/customers/${ID}/accounts$`, 'u'),
        new RegExp(`^/internal/customer-accounts/${ID}$`, 'u'),
        new RegExp(`^/internal/customer-accounts/${ID}/balance$`, 'u'),
        new RegExp(
          `^/internal/customer-accounts/${ID}/transactions${QUERY}$`,
          'u',
        ),
        new RegExp(
          `^/internal/customer-accounts/${ID}/transactions/${ID}$`,
          'u',
        ),
      ],
    },
  },
  /** Double-entry posting, owned by Ledger. Separated so a read-only caller
   *  cannot be granted the ability to move money by holding one token. */
  'ledger.postings': {
    routeId: 'ledger.postings',
    service: 'ledger',
    capability: {
      operationPrefix: 'ledger.postings',
      methods: ['POST'],
      pathPatterns: [
        /^\/internal\/customer-transfers\/preview$/u,
        /^\/internal\/customer-transfers$/u,
      ],
    },
  },
  /** Transfer orchestration, owned by Payments. */
  'payments.transfer': {
    routeId: 'payments.transfer',
    service: 'payments',
    capability: {
      operationPrefix: 'payments.transfer',
      methods: ['GET', 'POST'],
      pathPatterns: [
        /^\/internal\/transfer-policy$/u,
        /^\/internal\/transfer-intents$/u,
        new RegExp(`^/internal/transfer-intents/${ID}/authorize$`, 'u'),
        /^\/internal\/transfers$/u,
        new RegExp(`^/internal/customers/${ID}/transfers${QUERY}$`, 'u'),
        new RegExp(`^/internal/customers/${ID}/transfers/${ID}$`, 'u'),
      ],
    },
  },
} as const satisfies Record<
  string,
  { routeId: string; service: string; capability: SabclCapability }
>;

export type SabclCapabilityId = keyof typeof SABCL_CAPABILITIES;

/** Every capability a given service is responsible for serving. */
export function capabilitiesForService(service: string): SabclCapability[] {
  return Object.values(SABCL_CAPABILITIES)
    .filter((entry) => entry.service === service)
    .map((entry) => entry.capability);
}

/** Route identifiers a given service owns. */
export function routeIdsForService(service: string): string[] {
  return Object.values(SABCL_CAPABILITIES)
    .filter((entry) => entry.service === service)
    .map((entry) => entry.routeId);
}
