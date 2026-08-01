import {
  SABCL_CAPABILITIES,
  SabclClient,
  SabclError,
  abbreviateKey,
  loadSabclEnvironment,
  type SabclCapabilityId,
  type SabclEnvironment,
  type SabclInnerResponse,
} from '@aegis/sabcl';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/gateway.config';

export interface SabclCallOptions {
  capability: SabclCapabilityId;
  operation: string;
  method: 'GET' | 'POST';
  path: string;
  correlationId: string;
  body?: unknown;
  customerId?: string;
}

/**
 * The gateway's sender side.
 *
 * This is the only place in the gateway that speaks SABCL, and it is a server
 * -side service: nothing here is reachable from a browser, no cryptographic API
 * is exposed to the client bundle, and the browser cannot name a capability, a
 * route or a path. A customer's request arrives at a gateway controller, is
 * authenticated and validated there as it always was, and only then does the
 * controller choose which capability to invoke.
 */
@Injectable()
export class SabclTransportService {
  private readonly logger = new Logger('gateway-sabcl');
  private readonly environment: SabclEnvironment | null;
  private readonly client: SabclClient | null;

  constructor(@Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig) {
    this.environment = loadSabclEnvironment({
      mode: process.env.SABCL_MODE,
      keyId: process.env.SABCL_GATEWAY_KEY_ID,
      encryptionPrivateKey: process.env.SABCL_GATEWAY_ENCRYPTION_PRIVATE_KEY,
      signingPrivateKey: process.env.SABCL_GATEWAY_SIGNING_PRIVATE_KEY,
      peers: process.env.SABCL_PEERS,
      routeSecret: process.env.SABCL_ROUTE_SECRET,
      nodeEnvironment: config.nodeEnvironment,
    });

    this.client = this.environment
      ? new SabclClient({
          keyring: this.environment.keyring,
          routerUrl: config.sabclRouterUrl,
          routeSecret: this.environment.routeSecret,
          timeoutMs: config.sabclTimeoutMs,
        })
      : null;

    if (this.environment) {
      this.logger.log(
        JSON.stringify({
          event: 'sabcl.transport.ready',
          mode: this.environment.mode,
          key: abbreviateKey(this.environment.keyring.own),
        }),
      );
    }
  }

  /** True when calls must go through the router with no fallback. */
  get strict(): boolean {
    return this.environment?.mode === 'strict';
  }

  /** True when SABCL is configured at all. */
  get enabled(): boolean {
    return this.client !== null;
  }

  get mode(): string {
    return this.environment?.mode ?? 'off';
  }

  /**
   * Operator status. Abbreviated key fingerprints only — never the keys
   * themselves, never the route secret, never a route token.
   */
  status() {
    if (!this.environment) {
      return {
        mode: 'off' as const,
        strict: false,
        key: null,
        peers: [] as string[],
      };
    }
    return {
      mode: this.environment.mode,
      strict: this.environment.mode === 'strict',
      key: abbreviateKey(this.environment.keyring.own),
      peers: this.environment.keyring.peerKeyIds(),
    };
  }

  async routerReady(): Promise<boolean> {
    return this.client ? this.client.routerReady() : false;
  }

  /**
   * Sends one call through the blind router.
   *
   * Throws rather than returning a plaintext result when SABCL is not
   * configured. A caller that wants the legacy direct path must ask for it
   * explicitly by checking {@link enabled} first; there is no implicit
   * downgrade inside this method.
   */
  async call(options: SabclCallOptions): Promise<SabclInnerResponse> {
    if (!this.client) {
      throw new SabclError('SABCL_NOT_CONFIGURED');
    }
    const capability = SABCL_CAPABILITIES[options.capability];
    return this.client.send({
      routeId: capability.routeId,
      service: capability.service,
      request: {
        op: options.operation,
        method: options.method,
        path: options.path,
        body: options.body,
        // The customer identifier is payload, not metadata. It is encrypted
        // here and re-attached as a header only inside the recipient's own
        // process.
        actor: options.customerId
          ? { customerId: options.customerId }
          : undefined,
        correlationId: options.correlationId,
      },
    });
  }
}
