import {
  sabclEnvelopeSchema,
  type SabclEnvelope,
  type SabclResponseEnvelope,
} from '../protocol/envelope.js';
import { SabclError, toSabclError } from '../protocol/errors.js';
import { openRequest, sealResponse } from '../protocol/seal.js';
import {
  sabclInnerRequestSchema,
  type SabclInnerRequest,
  type SabclInnerResponse,
} from '../protocol/payload.js';
import type { SabclKeyring } from '../crypto/keyring.js';
import type { SabclReplayStore } from '../replay/replay-store.js';

/**
 * A capability a recipient service is willing to serve.
 *
 * `pathPatterns` is the confused-deputy defence. A route token proves the
 * sender was allowed to reach *this capability*; it does not authorise every
 * internal path the service exposes. Each pattern is anchored, so
 * `/internal/customer-accounts/..%2f..` cannot walk out of the allowlist.
 */
export interface SabclCapability {
  /** Operation prefix this capability serves, e.g. `ledger.accounts`. */
  operationPrefix: string;
  /** Anchored patterns for the internal paths the capability may reach. */
  pathPatterns: readonly RegExp[];
  methods: readonly ('GET' | 'POST')[];
}

export interface SabclRecipientOptions {
  keyring: SabclKeyring;
  replayStore: SabclReplayStore;
  capabilities: readonly SabclCapability[];
  /** Executes the decrypted request against the service's own internals. */
  dispatch: (request: SabclInnerRequest) => Promise<SabclInnerResponse>;
  /** Injected in tests. Unix seconds. */
  now?: () => number;
}

export interface SabclRecipientOutcome {
  status: number;
  body: SabclResponseEnvelope | { error: { code: string } };
}

/**
 * Recipient side of SABCL.
 *
 * Decryption happens only here, inside the service that owns the data. The
 * router forwarded ciphertext; this is the first point in the path with a key
 * that opens it.
 */
export class SabclRecipient {
  constructor(private readonly options: SabclRecipientOptions) {}

  private now(): number {
    return this.options.now?.() ?? Math.floor(Date.now() / 1000);
  }

  /**
   * Handles one forwarded envelope.
   *
   * Never throws: every failure becomes a bare protocol code. A caller cannot
   * learn from this method whether a customer, account or transfer exists —
   * only whether the *message* was well formed, fresh, authentic and routable.
   */
  async handle(rawEnvelope: unknown): Promise<SabclRecipientOutcome> {
    let envelope: SabclEnvelope;
    try {
      const parsed = sabclEnvelopeSchema.safeParse(rawEnvelope);
      if (!parsed.success) throw new SabclError('SABCL_MALFORMED');
      envelope = parsed.data;
    } catch (error) {
      return this.reject(toSabclError(error, 'SABCL_MALFORMED'));
    }

    try {
      const opened = openRequest<unknown>({
        recipient: this.options.keyring.own,
        keyring: this.options.keyring,
        envelope,
        now: this.now(),
      });

      // Replay is checked after authentication so that an unauthenticated
      // message cannot burn a message identifier the legitimate sender may
      // still use. TTL matches the remaining validity window, so state is
      // retained for exactly as long as the message could be resubmitted.
      const ttl = Math.max(1, envelope.exp - this.now() + 1);
      if (!(await this.options.replayStore.remember(envelope.mid, ttl))) {
        throw new SabclError('SABCL_REPLAYED');
      }

      const innerParsed = sabclInnerRequestSchema.safeParse(opened.payload);
      if (!innerParsed.success) {
        throw new SabclError(
          'SABCL_MALFORMED',
          'inner request failed validation',
        );
      }
      const inner = innerParsed.data;
      this.assertCapability(inner);

      const result = await this.options.dispatch(inner);

      return {
        status: 200,
        body: sealResponse({
          responder: this.options.keyring.own,
          responseSecret: opened.responseSecret,
          correlationId: opened.messageId,
          payload: result,
        }),
      };
    } catch (error) {
      return this.reject(toSabclError(error));
    }
  }

  /**
   * Confirms the decrypted request stays inside the capability it claims.
   *
   * Rejecting here rather than at dispatch keeps the recipient from becoming a
   * generic internal proxy for any holder of any valid key.
   */
  private assertCapability(request: SabclInnerRequest): void {
    const capability = this.options.capabilities.find((candidate) =>
      request.op.startsWith(`${candidate.operationPrefix}.`),
    );
    if (!capability) {
      throw new SabclError('SABCL_ROUTE_INVALID', 'unknown capability');
    }
    if (!capability.methods.includes(request.method)) {
      throw new SabclError('SABCL_ROUTE_INVALID', 'method not permitted');
    }
    // Reject encoded traversal before matching, since a pattern written against
    // readable paths would not otherwise see `%2e%2e`.
    const decoded = safeDecode(request.path);
    if (decoded.includes('..') || decoded.includes('\\')) {
      throw new SabclError('SABCL_ROUTE_INVALID', 'path traversal');
    }
    if (
      !capability.pathPatterns.some((pattern) => pattern.test(request.path))
    ) {
      throw new SabclError('SABCL_ROUTE_INVALID', 'path not allowlisted');
    }
  }

  private reject(error: SabclError): SabclRecipientOutcome {
    return { status: statusForCode(error.code), body: error.toSafeResponse() };
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // An undecodable path is suspicious in itself; return it unchanged so the
    // traversal check still sees the raw form.
    return value;
  }
}

/**
 * HTTP status for a protocol code.
 *
 * Deliberately lossy: authentication, decryption, revocation and unknown-sender
 * failures all map to 401 so that an attacker probing with different key
 * identifiers cannot use the status line to tell which part of the check failed.
 */
export function statusForCode(code: string): number {
  switch (code) {
    case 'SABCL_OVERSIZED':
      return 413;
    case 'SABCL_REPLAYED':
    case 'SABCL_EXPIRED':
      return 409;
    case 'SABCL_ROUTE_INVALID':
    case 'SABCL_HOP_LIMIT_EXCEEDED':
      return 403;
    case 'SABCL_RECIPIENT_UNAVAILABLE':
    case 'SABCL_NOT_CONFIGURED':
      return 503;
    case 'SABCL_MALFORMED':
    case 'SABCL_UNSUPPORTED_VERSION':
      return 400;
    default:
      return 401;
  }
}
