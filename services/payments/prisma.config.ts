import { config as loadEnvironment } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';
loadEnvironment({
  path: resolve(process.cwd(), '..', '..', '.env'),
  quiet: true,
});
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url:
      process.env.PAYMENTS_DATABASE_URL ??
      'postgresql://aegis_payments:aegis-local-payments-change-me@127.0.0.1:5432/aegis_payments?schema=app',
  },
});
