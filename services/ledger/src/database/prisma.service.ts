import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import {
  LEDGER_CONFIG,
  type LedgerConfig,
} from '../common/config/ledger.config';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(LEDGER_CONFIG) config: LedgerConfig) {
    const schema =
      new URL(config.databaseUrl).searchParams.get('schema') || 'app';
    if (!/^[a-z_][a-z0-9_]*$/u.test(schema)) {
      throw new Error('Ledger database schema name is invalid.');
    }
    const adapter = new PrismaPg(
      {
        connectionString: config.databaseUrl,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
        max: 10,
      },
      { schema },
    );
    this.client = new PrismaClient({ adapter });
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
