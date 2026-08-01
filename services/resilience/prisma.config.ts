import { config as loadEnvironment } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

loadEnvironment({
  path: resolve(process.cwd(), '..', '..', '.env'),
  quiet: true,
});

const localResilienceDatabaseUrl =
  'postgresql://aegis_resilience:aegis-local-resilience-change-me@127.0.0.1:5432/aegis_resilience?schema=app';
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.RESILIENCE_DATABASE_URL ?? localResilienceDatabaseUrl,
  },
});
