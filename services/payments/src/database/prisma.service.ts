import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import {
  PAYMENTS_CONFIG,
  type PaymentsConfig,
} from '../common/config/payments.config';
// @ts-expect-error missing types
import * as pg from 'pg';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient;
  constructor(@Inject(PAYMENTS_CONFIG) config: PaymentsConfig) {
    const schema =
      new URL(config.databaseUrl).searchParams.get('schema') || 'app';
    if (!/^[a-z_][a-z0-9_]*$/u.test(schema))
      throw new Error('Payments database schema is invalid.');
    this.client = new PrismaClient({
      adapter: new PrismaPg(
        new pg.Pool({
          connectionString: config.databaseUrl,
          connectionTimeoutMillis: 5000,
          idleTimeoutMillis: 30000,
          max: 10,
        }),
        { schema },
      ),
    });
  }
  async onModuleInit() {
    await this.client.$connect();
  }
  async onModuleDestroy() {
    await this.client.$disconnect();
  }
  async isHealthy() {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
