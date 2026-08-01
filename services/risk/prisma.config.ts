import { config as loadEnvironment } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

loadEnvironment({
  path: resolve(process.cwd(), '..', '..', '.env'),
  quiet: true,
});

const localRiskDatabaseUrl =
  'postgresql://aegis_audit:aegis-local-audit-change-me@127.0.0.1:5432/aegis_audit?schema=app';
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.RISK_DATABASE_URL ?? localRiskDatabaseUrl },
});
