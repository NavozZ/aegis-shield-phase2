import { config as loadEnvironment } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

loadEnvironment({
  path: resolve(process.cwd(), '..', '..', '.env'),
  quiet: true,
});

const localIdentityDatabaseUrl =
  'postgresql://aegis_identity:aegis-local-identity-change-me@127.0.0.1:5432/aegis_identity?schema=app';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.IDENTITY_DATABASE_URL ?? localIdentityDatabaseUrl,
  },
});
