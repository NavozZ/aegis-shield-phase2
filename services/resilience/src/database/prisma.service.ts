import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  RESILIENCE_CONFIG,
  type ResilienceConfig,
} from '../common/config/resilience.config';
import { PrismaClient } from '../generated/prisma/client';
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient;
  constructor(@Inject(RESILIENCE_CONFIG) config: ResilienceConfig) {
    const schema =
      new URL(config.databaseUrl).searchParams.get('schema') || 'app';
    if (!/^[a-z_][a-z0-9_]*$/u.test(schema))
      throw new Error('Resilience database schema is invalid.');
    this.client = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: config.databaseUrl,
          connectionTimeoutMillis: 5000,
          idleTimeoutMillis: 30000,
          max: 10,
        },
        { schema },
      ),
    });
  }
  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }
  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
  async isHealthy(): Promise<boolean> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
