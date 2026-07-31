import { Logger } from '@nestjs/common';
import { config as loadEnvironment } from 'dotenv';
import { resolve } from 'node:path';

export interface LedgerConfig {
  nodeEnvironment: string;
  host: string;
  port: number;
  databaseUrl: string;
  internalToken: string;
  defaultCurrency: string;
  idempotencyRetentionHours: number;
  maxPostingRetries: number;
}

export const LEDGER_CONFIG = Symbol('LEDGER_CONFIG');

const localDatabaseUrl =
  'postgresql://aegis_ledger:aegis-local-ledger-change-me@127.0.0.1:5432/aegis_ledger?schema=app';

export function loadRootEnvironment(): void {
  loadEnvironment({
    path: resolve(process.cwd(), '..', '..', '.env'),
    quiet: true,
  });
}

function integerSetting(name: string, fallback: number, minimum = 1): number {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) return fallback;

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(
      `${name} must be an integer greater than or equal to ${minimum}.`,
    );
  }
  return value;
}

function requiredSetting(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function validateProductionSecrets(config: LedgerConfig): void {
  if (config.nodeEnvironment !== 'production') return;

  const secretSettings: Array<[string, string]> = [
    ['LEDGER_INTERNAL_TOKEN', config.internalToken],
    ['LEDGER_DATABASE_URL', config.databaseUrl],
  ];
  const unsafeValues = secretSettings.filter(([, value]) =>
    /change-me|local-only|placeholder|example-only/iu.test(value),
  );

  if (unsafeValues.length > 0) {
    throw new Error(
      'Production ledger configuration contains local placeholder secrets.',
    );
  }
}

export function createLedgerConfig(): LedgerConfig {
  loadRootEnvironment();
  const config: LedgerConfig = {
    nodeEnvironment: process.env.NODE_ENV?.trim() || 'development',
    host: process.env.LEDGER_HOST?.trim() || '127.0.0.1',
    port: integerSetting('LEDGER_SERVICE_PORT', 4102),
    databaseUrl: process.env.LEDGER_DATABASE_URL?.trim() || localDatabaseUrl,
    internalToken: requiredSetting('LEDGER_INTERNAL_TOKEN'),
    defaultCurrency: process.env.LEDGER_DEFAULT_CURRENCY?.trim() || 'LKR',
    idempotencyRetentionHours: integerSetting(
      'LEDGER_IDEMPOTENCY_RETENTION_HOURS',
      24,
    ),
    maxPostingRetries: integerSetting('LEDGER_MAX_POSTING_RETRIES', 3),
  };

  if (!/^[A-Z]{3}$/u.test(config.defaultCurrency)) {
    throw new Error('LEDGER_DEFAULT_CURRENCY must be an ISO 4217 alpha code.');
  }
  if (config.maxPostingRetries > 10) {
    throw new Error('LEDGER_MAX_POSTING_RETRIES must not exceed 10.');
  }
  validateProductionSecrets(config);

  if (config.nodeEnvironment !== 'production') {
    Logger.warn(
      'Ledger is using local-development configuration with synthetic accounts only.',
      'LedgerConfig',
    );
  }
  return config;
}
