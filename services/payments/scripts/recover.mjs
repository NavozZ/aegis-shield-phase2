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
  const { LedgerClient } = require(
    resolve(root, 'dist/transfers/ledger.client.js'),
  );
  const { TransfersService } = require(
    resolve(root, 'dist/transfers/transfers.service.js'),
  );
  const config = createPaymentsConfig();
  const prisma = new PrismaService(config);
  await prisma.onModuleInit();
  const result = await new TransfersService(
    prisma,
    new LedgerClient(config),
    config,
  ).recover();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  await prisma.onModuleDestroy();
} catch {
  process.stderr.write(
    'Payments recovery could not complete. Build the service and verify PostgreSQL.\n',
  );
  process.exitCode = 1;
}
