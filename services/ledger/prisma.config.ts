import { config as loadEnvironment } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

loadEnvironment({
  path: resolve(process.cwd(), '..', '..', '.env'),
  quiet: true,
});

const localLedgerDatabaseUrl =
  'postgresql://aegis_ledger:aegis-local-ledger-change-me@127.0.0.1:5432/aegis_ledger?schema=app';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.LEDGER_DATABASE_URL ?? localLedgerDatabaseUrl,
  },
});
