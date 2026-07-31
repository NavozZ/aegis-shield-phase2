#!/usr/bin/env node

/**
 * Runs ledger reconciliation against the configured database and prints a safe
 * summary. Requires PostgreSQL, so it runs in GitHub Actions or on a
 * Docker-capable machine — never as part of a plain unit-test run.
 *
 * Exits non-zero when reconciliation fails so CI treats drift as a build break.
 */

import { config as loadEnvironment } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnvironment({
  path: resolve(serviceRoot, '..', '..', '.env'),
  quiet: true,
});

const require = createRequire(import.meta.url);
const distEntry = resolve(serviceRoot, 'dist');

let PrismaService;
let ReconciliationService;
let createLedgerConfig;
try {
  ({ PrismaService } = require(
    resolve(distEntry, 'database/prisma.service.js'),
  ));
  ({ ReconciliationService } = require(
    resolve(distEntry, 'reconciliation/reconciliation.service.js'),
  ));
  ({ createLedgerConfig } = require(
    resolve(distEntry, 'common/config/ledger.config.js'),
  ));
} catch {
  process.stderr.write(
    'Ledger build output is missing. Run "pnpm --filter @aegis/ledger-service build" first.\n',
  );
  process.exit(1);
}

const config = createLedgerConfig();
const prisma = new PrismaService(config);
let exitCode = 0;

try {
  await prisma.onModuleInit();
  const reconciliation = new ReconciliationService(prisma);
  const result = await reconciliation.run(randomUUID());

  // Only counts, statuses and non-customer identifiers are printed.
  process.stdout.write(
    `${JSON.stringify(
      {
        status: result.status,
        checkedJournalEntries: result.checkedJournalEntries,
        checkedPostings: result.checkedPostings,
        checkedLedgerAccounts: result.checkedLedgerAccounts,
        checkedCustomerAccounts: result.checkedCustomerAccounts,
        issueCount: result.issueCount,
        issues: result.issues.map((issue) => ({
          code: issue.code,
          severity: issue.severity,
        })),
      },
      null,
      2,
    )}\n`,
  );
  if (result.status !== 'PASS') exitCode = 1;
} catch (error) {
  // Operator diagnostics only: the error class plus Prisma's bounded error code
  // (for example P2010 or P2021). Database messages can quote row values, so
  // they are never printed.
  const errorName =
    error instanceof Error ? error.constructor.name : 'UnknownError';
  const errorCode =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Za-z0-9_-]{1,32}$/u.test(error.code)
      ? error.code
      : 'unknown';
  // Prisma's meta carries the database's own diagnostic. It is printed only to
  // the operator console, bounded in length, and never returned over HTTP.
  const meta =
    typeof error === 'object' && error !== null && 'meta' in error
      ? JSON.stringify(error.meta).slice(0, 500)
      : '';
  process.stderr.write(
    `Ledger reconciliation could not complete: ${errorName} (${errorCode}) ${meta}\n`,
  );
  exitCode = 1;
} finally {
  await prisma.onModuleDestroy().catch(() => undefined);
}

process.exit(exitCode);
