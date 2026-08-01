import { abbreviateKey, SABCL_PROTOCOL_VERSION } from '@aegis/sabcl';
import { Controller, Get, HttpCode, Inject } from '@nestjs/common';
import {
  ROUTER_CONFIG,
  type RouterConfig,
} from '../common/config/router.config';
import { RouterRedisService } from '../redis/redis.service';
import { RouterService } from '../routing/router.service';

/**
 * Health and operator status.
 *
 * Everything returned here is either structural (protocol version, mode) or an
 * abbreviated key fingerprint. No private key, no full public key, no route
 * token, no destination URL and no decrypted anything. `/sabcl/v1/status` is
 * the source for the operator page in the web app, which is why its shape is
 * deliberately narrow.
 */
@Controller()
export class HealthController {
  constructor(
    @Inject(ROUTER_CONFIG) private readonly config: RouterConfig,
    private readonly redis: RouterRedisService,
    private readonly router: RouterService,
  ) {}

  @Get('health/live')
  @HttpCode(200)
  live() {
    return { status: 'ok' };
  }

  @Get('health/ready')
  async ready() {
    const redisReady = await this.redis.ping();
    return {
      status: redisReady ? 'ok' : 'degraded',
      // Replay protection is not optional: without Redis the router cannot
      // guarantee single delivery, so it reports itself unready rather than
      // silently forwarding duplicates.
      replayState: redisReady ? 'ok' : 'unavailable',
    };
  }

  @Get('sabcl/v1/status')
  async status() {
    const now = Math.floor(Date.now() / 1_000);
    const destinations = await this.router.destinationHealth();
    return {
      protocolVersion: SABCL_PROTOCOL_VERSION,
      mode: this.config.sabcl.mode,
      strict: this.config.sabcl.mode === 'strict',
      routerKey: abbreviateKey(this.config.sabcl.keyring.own),
      rotation: this.config.sabcl.keyring.rotationState(now),
      routes: this.config.routes.liveRouteIds(),
      // Reachability by capability, not by URL: an operator needs to know which
      // capability is degraded, not which host serves it.
      reachability: destinations.map((entry) => ({
        routeId: entry.routeId,
        service: entry.service,
        reachable: entry.reachable,
      })),
      padding: { policy: 'bucketed', unit: 'bytes' },
      counters: this.router.counterSnapshot(),
      replayState: (await this.redis.ping()) ? 'ok' : 'unavailable',
    };
  }
}
