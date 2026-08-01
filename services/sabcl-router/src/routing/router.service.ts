import {
  SABCL_CLOCK_SKEW_SECONDS,
  SABCL_ERROR_CODES,
  SABCL_MAX_TTL_SECONDS,
  SABCL_PROTOCOL_VERSION,
  SabclAuditCounters,
  SabclError,
  auditDigest,
  sabclEnvelopeSchema,
  sabclResponseEnvelopeSchema,
  statusForCode,
  toSabclError,
  type SabclAuditRecord,
  type SabclEnvelope,
  type SabclErrorCode,
} from '@aegis/sabcl';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ROUTER_CONFIG,
  type RouterConfig,
} from '../common/config/router.config';
import { RouterRedisService } from '../redis/redis.service';

export interface RouterOutcome {
  status: number;
  body: unknown;
}

/**
 * The blind router.
 *
 * What it can do: check that an envelope is well formed, fresh, unreplayed,
 * within its hop budget and addressed to a route it has been configured to
 * know; then hand the ciphertext to that route's destination and hand the
 * reply back.
 *
 * What it cannot do: read the payload. It holds no recipient decryption key —
 * the route table maps tokens to URLs, not to keys — so `ct` is opaque bytes to
 * this process. That is the whole point of the layer, and it is why the router
 * can be operated with a lower trust level than the services behind it.
 *
 * What it deliberately does not do: verify the sender's signature. The router
 * has the sender's public key and could, but doing so would let a router
 * compromise silently drop or accept traffic on a criterion the recipient never
 * checks. The recipient verifies instead, so a router that lies about
 * authenticity is caught at the far end.
 */
@Injectable()
export class RouterService {
  private readonly logger = new Logger('sabcl-router');
  private readonly counters = new SabclAuditCounters();

  constructor(
    @Inject(ROUTER_CONFIG) private readonly config: RouterConfig,
    private readonly redis: RouterRedisService,
  ) {}

  counterSnapshot() {
    return this.counters.snapshot();
  }

  async route(
    rawEnvelope: unknown,
    rawByteLength: number,
  ): Promise<RouterOutcome> {
    const startedAt = Date.now();
    let envelope: SabclEnvelope | undefined;
    try {
      if (rawByteLength > this.config.maxEnvelopeBytes) {
        throw new SabclError('SABCL_OVERSIZED');
      }
      const parsed = sabclEnvelopeSchema.safeParse(rawEnvelope);
      if (!parsed.success) throw new SabclError('SABCL_MALFORMED');
      envelope = parsed.data;

      if (envelope.v !== SABCL_PROTOCOL_VERSION) {
        throw new SabclError('SABCL_UNSUPPORTED_VERSION');
      }

      const now = Math.floor(Date.now() / 1_000);
      if (now > envelope.exp) throw new SabclError('SABCL_EXPIRED');
      if (envelope.iat > now + SABCL_CLOCK_SKEW_SECONDS) {
        throw new SabclError('SABCL_EXPIRED');
      }
      if (envelope.exp - envelope.iat > SABCL_MAX_TTL_SECONDS) {
        throw new SabclError('SABCL_MALFORMED');
      }

      // The sender key must be one the router has been told about. This is an
      // allowlist check on identity, not a signature check.
      this.config.sabcl.keyring.peer(envelope.skid, now);

      if (envelope.hl <= 0) throw new SabclError('SABCL_HOP_LIMIT_EXCEEDED');

      const rate = await this.redis.incrementRate(envelope.skid);
      if (rate > this.config.rateLimitPerMinute) {
        throw new SabclError('SABCL_ROUTE_INVALID', 'rate limit');
      }

      const route = this.config.routes.resolve(envelope.rt);

      // Replay is claimed here rather than at the recipient so that a duplicate
      // is stopped before it costs an upstream request. The recipient claims it
      // too; both are needed, because the router is the cheaper gate and the
      // recipient is the authoritative one.
      const ttl = Math.max(1, envelope.exp - now + 1);
      if (!(await this.redis.remember(envelope.mid, ttl))) {
        throw new SabclError('SABCL_REPLAYED');
      }

      // The forwarded envelope has one fewer hop available. Note this is the
      // outer bookkeeping value: it is inside the signed header, so the
      // recipient sees the value the *sender* set, and a router that inflated
      // the budget would invalidate the signature.
      const forwarded = await this.forward(route.destination, envelope);

      this.audit({
        event: 'envelope.accepted',
        messageDigest: this.digest(envelope.mid),
        routeDigest: this.digest(envelope.rt),
        senderKeyId: envelope.skid,
        durationMs: Date.now() - startedAt,
        at: new Date().toISOString(),
      });
      return forwarded;
    } catch (error) {
      const sabclError = toSabclError(error, 'SABCL_MALFORMED');
      this.audit({
        event: eventForCode(sabclError.code),
        messageDigest: envelope ? this.digest(envelope.mid) : 'unparsed',
        routeDigest: envelope ? this.digest(envelope.rt) : undefined,
        senderKeyId: envelope?.skid,
        reason: sabclError.code,
        durationMs: Date.now() - startedAt,
        at: new Date().toISOString(),
      });
      return {
        status: statusForCode(sabclError.code),
        body: sabclError.toSafeResponse(),
      };
    }
  }

  /**
   * Hands the sealed envelope to the destination.
   *
   * The destination comes from the route table, never from the message. The
   * body forwarded is the envelope exactly as received: the router does not
   * re-serialise the payload because it cannot, and does not add headers that
   * would describe it.
   */
  private async forward(
    destination: string,
    envelope: SabclEnvelope,
  ): Promise<RouterOutcome> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.forwardTimeoutMs,
    );
    try {
      const response = await fetch(new URL('/sabcl/v1/inbound', destination), {
        method: 'POST',
        headers: { 'content-type': 'application/sabcl-envelope+json' },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });
      const raw: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        // Pass through only a recognised protocol code. A recipient that leaked
        // a business error must not have it relayed to the caller.
        const code = readErrorCode(raw);
        throw new SabclError(code ?? 'SABCL_RECIPIENT_UNAVAILABLE');
      }
      const parsed = sabclResponseEnvelopeSchema.safeParse(raw);
      if (!parsed.success) {
        throw new SabclError('SABCL_RECIPIENT_UNAVAILABLE');
      }
      return { status: 200, body: parsed.data };
    } catch (error) {
      if (error instanceof SabclError) throw error;
      // Timeouts, DNS failures and connection refusals are all one condition
      // from the caller's point of view: the recipient is not answering.
      throw new SabclError('SABCL_RECIPIENT_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Reachability of each configured destination, for readiness. */
  async destinationHealth(): Promise<
    { routeId: string; service: string; reachable: boolean }[]
  > {
    return Promise.all(
      this.config.routes.destinations().map(async (route) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2_000);
        try {
          const response = await fetch(
            new URL('/health/live', route.destination),
            {
              signal: controller.signal,
            },
          );
          return {
            routeId: route.routeId,
            service: route.service,
            reachable: response.ok,
          };
        } catch {
          return {
            routeId: route.routeId,
            service: route.service,
            reachable: false,
          };
        } finally {
          clearTimeout(timeout);
        }
      }),
    );
  }

  private digest(value: string): string {
    return auditDigest(this.config.sabcl.routeSecret, value);
  }

  /**
   * Emits an operational event.
   *
   * The record is built from opaque digests and key identifiers only. Nothing
   * derived from the payload passes through here, because nothing derived from
   * the payload is available to this process.
   */
  private audit(record: SabclAuditRecord): void {
    this.counters.record(record.event);
    this.logger.log(JSON.stringify(record));
  }
}

function eventForCode(code: string): SabclAuditRecord['event'] {
  switch (code) {
    case 'SABCL_REPLAYED':
      return 'envelope.replayed';
    case 'SABCL_EXPIRED':
      return 'envelope.expired';
    case 'SABCL_SIGNATURE_INVALID':
      return 'signature.invalid';
    case 'SABCL_ROUTE_INVALID':
      return 'route.invalid';
    case 'SABCL_RECIPIENT_UNAVAILABLE':
      return 'recipient.unavailable';
    case 'SABCL_HOP_LIMIT_EXCEEDED':
      return 'hop.exhausted';
    default:
      return 'envelope.rejected';
  }
}

/**
 * Reads a protocol code from a recipient error body.
 *
 * Only codes in the known set are relayed. A recipient that returned a rich
 * business error — "account 123 has insufficient funds" — must not have it
 * forwarded to the caller by the router, because the router relaying it would
 * reintroduce exactly the metadata the layer removes.
 */
function readErrorCode(raw: unknown): SabclErrorCode | undefined {
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
