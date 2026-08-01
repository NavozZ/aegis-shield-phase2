import type { SabclReplayStore } from '@aegis/sabcl';
import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';
import {
  ROUTER_CONFIG,
  type RouterConfig,
} from '../common/config/router.config';

/**
 * Redis-backed replay and rate-limit state.
 *
 * Keys are namespaced under SABCL_REDIS_PREFIX so router state cannot collide
 * with the identity service's session state in a shared Redis.
 */
@Injectable()
export class RouterRedisService
  implements SabclReplayStore, OnModuleInit, OnModuleDestroy
{
  private readonly client: RedisClientType;
  private readonly prefix: string;

  constructor(@Inject(ROUTER_CONFIG) config: RouterConfig) {
    this.client = createClient({ url: config.redisUrl });
    this.prefix = config.redisKeyPrefix;
    // A connection error must not crash the process; readiness reports it and
    // the forwarding path fails closed.
    this.client.on('error', () => undefined);
  }

  async onModuleInit(): Promise<void> {
    if (!this.client.isOpen) await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }

  key(...parts: string[]): string {
    return `${this.prefix}${parts.join(':')}`;
  }

  /**
   * Atomic first-use claim on a message identifier.
   *
   * SET NX is a single round trip and a single Redis command, so two concurrent
   * copies of the same envelope cannot both observe "unseen" — which is what
   * makes duplicate submission of a transfer impossible rather than unlikely.
   */
  async remember(messageId: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(this.key('replay', messageId), '1', {
      NX: true,
      EX: Math.max(1, ttlSeconds),
    });
    return result === 'OK';
  }

  /**
   * Fixed-window counter per sender key.
   *
   * Deliberately coarse: this is a flood brake in front of the cryptography,
   * not a fairness mechanism.
   */
  async incrementRate(
    senderKeyId: string,
    windowSeconds = 60,
  ): Promise<number> {
    const key = this.key('rate', senderKeyId);
    const count = await this.client.incr(key);
    if (count === 1) await this.client.expire(key, windowSeconds);
    return count;
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  /** Test-only cleanup, guarded so it can never run against a real prefix. */
  async cleanupIsolatedTestPrefix(): Promise<void> {
    if (
      process.env.NODE_ENV !== 'test' ||
      !this.prefix.startsWith('aegis:sabcl:test:')
    ) {
      throw new Error(
        'SABCL Redis test cleanup requires NODE_ENV=test and an isolated test prefix.',
      );
    }
    for await (const keys of this.client.scanIterator({
      MATCH: `${this.prefix}*`,
      COUNT: 100,
    })) {
      if (keys.length > 0) await this.client.unlink(keys);
    }
  }
}
