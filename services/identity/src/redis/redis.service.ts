import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';
import {
  IDENTITY_CONFIG,
  type IdentityConfig,
} from '../common/config/identity.config';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly client: RedisClientType;
  private readonly prefix: string;

  constructor(@Inject(IDENTITY_CONFIG) config: IdentityConfig) {
    this.client = createClient({ url: config.redisUrl });
    this.prefix = config.redisKeyPrefix;
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

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, { EX: ttlSeconds });
  }

  async setKeepingTtl(key: string, value: string): Promise<void> {
    await this.client.set(key, value, { KEEPTTL: true });
  }

  async delete(...keys: string[]): Promise<void> {
    if (keys.length > 0) await this.client.del(keys);
  }

  async getDel(key: string): Promise<string | null> {
    return this.client.getDel(key);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async incrementWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.client.incr(key);
    if (count === 1) await this.client.expire(key, ttlSeconds);
    return count;
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async cleanupIsolatedTestPrefix(): Promise<void> {
    if (
      process.env.NODE_ENV !== 'test' ||
      !this.prefix.startsWith('aegis:identity:test:')
    ) {
      throw new Error(
        'Redis test cleanup requires NODE_ENV=test and an isolated test prefix.',
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
