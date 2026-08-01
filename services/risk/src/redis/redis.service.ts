import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';
import { RISK_CONFIG, type RiskConfig } from '../common/config/risk.config';
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: RedisClientType;
  constructor(@Inject(RISK_CONFIG) private readonly config: RiskConfig) {
    this.client = createClient({ url: config.redisUrl });
  }
  async onModuleInit(): Promise<void> {
    await this.client.connect();
  }
  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }
  key(...parts: string[]): string {
    return `${this.config.redisPrefix}${parts.map((part) => part.replace(/[^A-Za-z0-9:_-]/gu, '_')).join(':')}`;
  }
  async isHealthy(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
