import { SabclError } from '../protocol/errors.js';
import type {
  SabclInnerRequest,
  SabclInnerResponse,
} from '../protocol/payload.js';

/*
 * Dispatching a decrypted request into the service that owns it.
 *
 * The request is replayed against the service's own HTTP surface on the
 * loopback interface, carrying the internal token it would have carried had the
 * gateway called directly. That is deliberate, and it is what makes SABCL an
 * adapter rather than a rewrite: every existing guard, validation pipe,
 * exception filter and contract check runs exactly as before, so the behaviour
 * of a SABCL-routed call and a direct call cannot drift apart.
 *
 * The cost is one loopback request per call. The alternative — reaching into
 * the service's controllers directly — would bypass the guards and would mean
 * two code paths to keep in agreement.
 *
 * The path has already been checked against the capability allowlist by
 * SabclRecipient before this runs. This function does not re-authorise; it
 * assumes it is called only after that check.
 */

export interface LoopbackDispatchOptions {
  /** The service's own base URL, e.g. http://127.0.0.1:4102. */
  baseUrl: string;
  /** The internal token this service expects on its own internal routes. */
  internalToken: string;
  timeoutMs: number;
  /** Header carrying the internal token. Matches the existing services. */
  tokenHeader?: string;
  fetchImplementation?: typeof fetch;
}

export function createLoopbackDispatcher(
  options: LoopbackDispatchOptions,
): (request: SabclInnerRequest) => Promise<SabclInnerResponse> {
  const base = new URL(options.baseUrl);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new SabclError(
      'SABCL_NOT_CONFIGURED',
      'loopback base URL must be HTTP or HTTPS',
    );
  }
  const call = options.fetchImplementation ?? fetch;
  const tokenHeader = options.tokenHeader ?? 'x-aegis-internal-token';

  return async (request) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const target = new URL(request.path, base);
      // Resolving against the base must not let a path escape the service. A
      // path like "//evil.test/x" would otherwise resolve to another origin.
      if (target.origin !== base.origin) {
        throw new SabclError('SABCL_ROUTE_INVALID', 'path changed origin');
      }

      const headers = new Headers({
        accept: 'application/json',
        'content-type': 'application/json',
        [tokenHeader]: options.internalToken,
        'x-correlation-id': request.correlationId,
      });
      // The actor identity arrives encrypted and is re-attached here, in the
      // service's own process. It was never a routing header.
      if (request.actor?.customerId) {
        headers.set('x-aegis-customer-id', request.actor.customerId);
      }

      const response = await call(target, {
        method: request.method,
        headers,
        body:
          request.method === 'POST'
            ? JSON.stringify(request.body ?? {})
            : undefined,
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => undefined);
      // The upstream status and body are returned as-is *inside the encrypted
      // response*. A 404 travels sealed, so the router still cannot tell a
      // missing resource from a present one.
      return { status: response.status, body };
    } catch (error) {
      if (error instanceof SabclError) throw error;
      throw new SabclError('SABCL_RECIPIENT_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }
  };
}
