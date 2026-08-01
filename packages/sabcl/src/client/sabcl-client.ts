import {
  sabclResponseEnvelopeSchema,
  type SabclResponseEnvelope,
} from '../protocol/envelope.js';
import {
  SABCL_ERROR_CODES,
  SabclError,
  type SabclErrorCode,
} from '../protocol/errors.js';
import { openResponse, sealRequest } from '../protocol/seal.js';
import {
  sabclInnerResponseSchema,
  type SabclInnerRequest,
  type SabclInnerResponse,
} from '../protocol/payload.js';
import { deriveRouteToken } from '../protocol/route-token.js';
import type { SabclKeyring } from '../crypto/keyring.js';
import {
  SABCL_DEFAULT_HOP_LIMIT,
  SABCL_DEFAULT_TTL_SECONDS,
  SABCL_MAX_ENVELOPE_BYTES,
} from '../protocol/version.js';

export interface SabclClientOptions {
  keyring: SabclKeyring;
  /** Base URL of the blind router. */
  routerUrl: string;
  /** Shared secret used to derive route tokens. */
  routeSecret: Buffer;
  timeoutMs: number;
  ttlSeconds?: number;
  hopLimit?: number;
  /** Injected in tests so a call can be driven without a live socket. */
  fetchImplementation?: typeof fetch;
}

export interface SabclSendOptions {
  /** Capability being invoked, e.g. `ledger.accounts`. Selects the route token. */
  routeId: string;
  /** Service that owns the capability. Selects the recipient key. */
  service: string;
  request: SabclInnerRequest;
}

/**
 * Sender side of SABCL.
 *
 * Encryption happens here, in the calling service's process, *before* anything
 * is handed to the router. The router receives an envelope that is already
 * sealed to the recipient, so there is no point in the path at which the router
 * could read the payload even if it wanted to.
 */
export class SabclClient {
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: SabclClientOptions) {
    const protocol = new URL(options.routerUrl).protocol;
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new SabclError(
        'SABCL_NOT_CONFIGURED',
        'router URL must be HTTP or HTTPS',
      );
    }
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async send(options: SabclSendOptions): Promise<SabclInnerResponse> {
    const now = Math.floor(Date.now() / 1000);
    const recipient = this.options.keyring.activePeerFor(options.service, now);
    const sealed = sealRequest({
      sender: this.options.keyring.own,
      recipient,
      routeToken: deriveRouteToken(this.options.routeSecret, options.routeId),
      payload: options.request,
      ttlSeconds: this.options.ttlSeconds ?? SABCL_DEFAULT_TTL_SECONDS,
      hopLimit: this.options.hopLimit ?? SABCL_DEFAULT_HOP_LIMIT,
      now,
    });

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs,
    );
    let responseEnvelope: SabclResponseEnvelope;
    try {
      const response = await this.fetchImplementation(
        new URL('/sabcl/v1/messages', this.options.routerUrl),
        {
          method: 'POST',
          headers: { 'content-type': 'application/sabcl-envelope+json' },
          body: JSON.stringify(sealed.envelope),
          signal: controller.signal,
        },
      );
      const raw: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        // The router only ever returns a protocol-layer code. Anything richer
        // would be the router describing a payload it cannot read.
        throw new SabclError(
          extractErrorCode(raw) ?? 'SABCL_RECIPIENT_UNAVAILABLE',
        );
      }
      const parsed = sabclResponseEnvelopeSchema.safeParse(raw);
      if (!parsed.success) {
        throw new SabclError(
          'SABCL_MALFORMED',
          'router returned a bad envelope',
        );
      }
      responseEnvelope = parsed.data;
    } catch (error) {
      if (error instanceof SabclError) throw error;
      // A transport failure is a recipient-unavailable condition, never a
      // silent fall back to an unencrypted path.
      throw new SabclError('SABCL_RECIPIENT_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }

    const decoded = openResponse<unknown>({
      responder: recipient,
      responseSecret: sealed.responseSecret,
      expectedCorrelationId: sealed.envelope.mid,
      envelope: responseEnvelope,
    });
    const parsed = sabclInnerResponseSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new SabclError(
        'SABCL_MALFORMED',
        'inner response failed validation',
      );
    }
    return parsed.data;
  }

  /** Liveness of the router itself. Used by readiness surfaces, not by callers. */
  async routerReady(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs,
    );
    try {
      const response = await this.fetchImplementation(
        new URL('/health/ready', this.options.routerUrl),
        { signal: controller.signal },
      );
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Reads a protocol code out of a router error body.
 *
 * Only codes the sender recognises are honoured; anything else collapses to
 * `SABCL_RECIPIENT_UNAVAILABLE` so a hostile or buggy router cannot inject an
 * arbitrary string into the caller's error handling.
 */
function extractErrorCode(raw: unknown): SabclErrorCode | undefined {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'error' in raw &&
    typeof (raw as { error?: { code?: unknown } }).error?.code === 'string'
  ) {
    const code = (raw as { error: { code: string } }).error.code;
    return (SABCL_ERROR_CODES as readonly string[]).includes(code)
      ? (code as SabclErrorCode)
      : undefined;
  }
  return undefined;
}

export { SABCL_MAX_ENVELOPE_BYTES };
