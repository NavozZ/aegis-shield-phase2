import {
  sabclRouterStatusSchema,
  sabclStatusResponseSchema,
  type SabclRouterStatus,
  type SabclStatusResponse,
} from '@aegis/contracts';
import { Controller, Get, Inject } from '@nestjs/common';
import { SABCL_PROTOCOL_VERSION } from '@aegis/sabcl';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/gateway.config';
import { SabclTransportService } from './sabcl-transport.service';

/**
 * Operator status for the SABCL layer.
 *
 * Read-only, and deliberately narrow. What it returns: mode, protocol version,
 * abbreviated key fingerprints, rotation state, capability names, reachability
 * and counters. What it never returns: private keys, full public keys, the
 * route secret, raw route tokens, decrypted payloads, customer or account
 * identifiers.
 *
 * This endpoint describes the control plane. It is not itself a security
 * control, and the page that renders it says so.
 */
@Controller('api/v1/sabcl')
export class SabclStatusController {
  constructor(
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
    private readonly sabcl: SabclTransportService,
  ) {}

  @Get('status')
  async status(): Promise<SabclStatusResponse> {
    const transport = this.sabcl.status();
    const routerReachable = await this.sabcl.routerReady();
    const response = {
      protocolVersion: SABCL_PROTOCOL_VERSION,
      mode: transport.mode,
      strict: transport.strict,
      gatewayKey: transport.key,
      peerKeyIds: transport.peers,
      routerReachable,
      router: routerReachable ? await this.fetchRouterStatus() : null,
    };
    // Validating our own output is the point of the strict contract: it means a
    // future change that started returning key material would fail here rather
    // than reach a browser.
    return sabclStatusResponseSchema.parse(response);
  }

  /**
   * Reads the router's own status view.
   *
   * Proxied through the gateway rather than exposed directly so the router
   * never needs to be reachable from a browser. The router's answer is
   * re-validated: the gateway does not forward an upstream document it has not
   * checked.
   */
  private async fetchRouterStatus(): Promise<SabclRouterStatus | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    try {
      const response = await fetch(
        new URL('/sabcl/v1/status', this.config.sabclRouterUrl),
        { signal: controller.signal },
      );
      if (!response.ok) return null;
      const parsed = sabclRouterStatusSchema.safeParse(
        await response.json().catch(() => undefined),
      );
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
