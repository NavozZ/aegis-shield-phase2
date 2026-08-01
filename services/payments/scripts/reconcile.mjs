#!/usr/bin/env node
import { config as loadEnvironment } from 'dotenv';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnvironment({ path: resolve(root, '..', '..', '.env'), quiet: true });
const require = createRequire(import.meta.url);
try {
  const { createPaymentsConfig } = require(
    resolve(root, 'dist/common/config/payments.config.js'),
  );
  const { PrismaService } = require(
    resolve(root, 'dist/database/prisma.service.js'),
  );
  const { PaymentsReconciliationService } = require(
    resolve(root, 'dist/reconciliation/payments-reconciliation.service.js'),
  );
  const prisma = new PrismaService(createPaymentsConfig());
  await prisma.onModuleInit();
  const result = await new PaymentsReconciliationService(prisma).run();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  await prisma.onModuleDestroy();
  process.exitCode = result.status === 'PASS' ? 0 : 1;
} catch {
  process.stderr.write(
    'Payments reconciliation could not complete. Build the service and verify PostgreSQL.\n',
  );
  process.exitCode = 1;
}
