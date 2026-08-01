import { SabclError } from './errors.js';
import { SABCL_DOMAIN, SABCL_ROUTE_TOKEN_BYTES } from './version.js';
import {
  hmacSha256,
  toBase64Url,
  timingSafeBytesEqual,
  fromBase64Url,
} from '../crypto/primitives.js';

/*
 * Route tokens replace destination names on the wire.
 *
 * A token is HMAC-SHA-256(routeSecret, domain || routeId), so it is:
 *   - irreversible: an observer who captures traffic cannot recover "payments"
 *     or "/internal/customer-transfers" from the token,
 *   - deterministic: sender and router derive the same token from the same
 *     shared secret without a provisioning round-trip, and
 *   - allowlist-bound: the router only ever recognises tokens it derived itself
 *     from its own configured route table, so an attacker-chosen token has
 *     nowhere to resolve to.
 *
 * The router is therefore not a general HTTP proxy. It cannot be pointed at an
 * arbitrary URL, because the URL is never in the message — only a token that
 * must already be a key in a table built at startup.
 *
 * A route identifier names a *capability*, not a path: `payments.transfer`
 * rather than `POST /internal/customer-transfers`. The mapping from capability
 * to concrete upstream path lives only in the recipient service.
 */

export const ROUTE_ID_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u;

export function assertRouteId(routeId: string): string {
  if (!ROUTE_ID_PATTERN.test(routeId)) {
    throw new SabclError('SABCL_ROUTE_INVALID', 'malformed route identifier');
  }
  return routeId;
}

/** Derives the opaque wire token for a route identifier. */
export function deriveRouteToken(routeSecret: Buffer, routeId: string): string {
  assertRouteId(routeId);
  if (routeSecret.length < 32) {
    throw new SabclError(
      'SABCL_NOT_CONFIGURED',
      'route secret must be at least 32 bytes',
    );
  }
  return toBase64Url(
    hmacSha256(routeSecret, `${SABCL_DOMAIN.routeToken}|${routeId}`).subarray(
      0,
      SABCL_ROUTE_TOKEN_BYTES,
    ),
  );
}

export interface SabclRoute {
  /** Capability name, e.g. `ledger.accounts`. */
  routeId: string;
  /** Service that owns the capability; must match the recipient key's service. */
  service: string;
  /** Base URL of the recipient. Never derived from the message. */
  destination: string;
  /** Set to remove the route from service without deleting its definition. */
  revoked?: boolean;
}

export interface ResolvedRoute {
  routeId: string;
  service: string;
  destination: string;
}

/**
 * Startup-built table of `token -> route`.
 *
 * Lookup is by token, and resolution is constant-time with respect to which
 * token was supplied so that probing cannot distinguish "unknown token" from
 * "revoked token" by timing. Both fail as `SABCL_ROUTE_INVALID`.
 */
export class SabclRouteTable {
  private readonly byToken = new Map<string, SabclRoute>();

  constructor(routeSecret: Buffer, routes: readonly SabclRoute[]) {
    if (routes.length === 0) {
      throw new SabclError('SABCL_NOT_CONFIGURED', 'route table is empty');
    }
    for (const route of routes) {
      assertRouteId(route.routeId);
      const protocol = new URL(route.destination).protocol;
      if (protocol !== 'http:' && protocol !== 'https:') {
        throw new SabclError(
          'SABCL_NOT_CONFIGURED',
          `route ${route.routeId} destination must be HTTP or HTTPS`,
        );
      }
      const token = deriveRouteToken(routeSecret, route.routeId);
      if (this.byToken.has(token)) {
        throw new SabclError(
          'SABCL_NOT_CONFIGURED',
          `duplicate route ${route.routeId}`,
        );
      }
      this.byToken.set(token, route);
    }
  }

  /**
   * Resolves a wire token to an allowlisted destination.
   *
   * Every candidate is compared in constant time and the loop always runs to
   * completion, so resolution time does not depend on where — or whether — the
   * token matched.
   */
  resolve(token: string): ResolvedRoute {
    let supplied: Buffer;
    try {
      supplied = fromBase64Url(token, 'rt');
    } catch {
      throw new SabclError('SABCL_ROUTE_INVALID');
    }
    let found: SabclRoute | undefined;
    for (const [candidateToken, route] of this.byToken) {
      const candidate = Buffer.from(candidateToken, 'base64url');
      if (timingSafeBytesEqual(supplied, candidate) && !route.revoked) {
        found = route;
      }
    }
    if (!found) {
      throw new SabclError('SABCL_ROUTE_INVALID');
    }
    return {
      routeId: found.routeId,
      service: found.service,
      destination: found.destination,
    };
  }

  /** Route identifiers currently in service, for operator display. */
  liveRouteIds(): string[] {
    return [...this.byToken.values()]
      .filter((route) => !route.revoked)
      .map((route) => route.routeId)
      .sort();
  }

  /** Distinct destinations, for readiness probing. Never returned to a browser. */
  destinations(): { routeId: string; service: string; destination: string }[] {
    return [...this.byToken.values()]
      .filter((route) => !route.revoked)
      .map((route) => ({
        routeId: route.routeId,
        service: route.service,
        destination: route.destination,
      }));
  }
}
