import { config as loadEnvironment } from 'dotenv';
import { resolve } from 'node:path';

export interface PaymentsConfig {
  nodeEnvironment: string;
  host: string;
  port: number;
  databaseUrl: string;
  internalToken: string;
  ledgerServiceUrl: string;
  ledgerInternalToken: string;
  minTransferMinor: bigint;
  maxTransferMinor: bigint;
  dailyOutgoingLimitMinor: bigint;
  intentTtlSeconds: number;
  httpTimeoutMs: number;
  recoveryStaleSeconds: number;
  maxProcessingAttempts: number;
  idempotencyRetentionHours: number;
  riskServiceUrl: string;
  riskInternalToken: string;
  riskPaymentsSourceToken: string;
  riskTimeoutMs: number;
  qrSigningKey: string;
  qrDynamicTtlSeconds: number;
  qrStaticTtlHours: number;
  redisUrl: string;
  redisKeyPrefix: string;
}
export const PAYMENTS_CONFIG = Symbol('PAYMENTS_CONFIG');

export function loadRootEnvironment(): void {
  loadEnvironment({
    path: resolve(process.cwd(), '..', '..', '.env'),
    quiet: true,
  });
}
function integer(name: string, fallback: number, minimum = 1): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error(`${name} is invalid.`);
  return value;
}
function minor(name: string, fallback: string): bigint {
  const raw = process.env[name]?.trim() || fallback;
  if (!/^[1-9]\d{0,23}$/u.test(raw))
    throw new Error(`${name} must be a positive minor-unit string.`);
  return BigInt(raw);
}
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
export function createPaymentsConfig(): PaymentsConfig {
  loadRootEnvironment();
  const config: PaymentsConfig = {
    nodeEnvironment: process.env.NODE_ENV?.trim() || 'development',
    host: process.env.PAYMENTS_HOST?.trim() || '127.0.0.1',
    port: integer('PAYMENTS_SERVICE_PORT', 4104),
    databaseUrl:
      process.env.PAYMENTS_DATABASE_URL?.trim() ||
      'postgresql://aegis_payments:aegis-local-payments-change-me@127.0.0.1:5432/aegis_payments?schema=app',
    internalToken: required('PAYMENTS_INTERNAL_TOKEN'),
    ledgerServiceUrl:
      process.env.LEDGER_SERVICE_URL?.trim() || 'http://127.0.0.1:4102',
    ledgerInternalToken: required('LEDGER_INTERNAL_TOKEN'),
    minTransferMinor: minor('PAYMENTS_MIN_TRANSFER_MINOR', '100'),
    maxTransferMinor: minor('PAYMENTS_MAX_TRANSFER_MINOR', '5000000'),
    dailyOutgoingLimitMinor: minor(
      'PAYMENTS_DAILY_OUTGOING_LIMIT_MINOR',
      '10000000',
    ),
    intentTtlSeconds: integer('PAYMENTS_INTENT_TTL_SECONDS', 300),
    httpTimeoutMs: integer('PAYMENTS_HTTP_TIMEOUT_MS', 5000, 100),
    recoveryStaleSeconds: integer('PAYMENTS_RECOVERY_STALE_SECONDS', 30),
    maxProcessingAttempts: integer('PAYMENTS_MAX_PROCESSING_ATTEMPTS', 5),
    idempotencyRetentionHours: integer(
      'PAYMENTS_IDEMPOTENCY_RETENTION_HOURS',
      24,
    ),
    riskServiceUrl:
      process.env.RISK_SERVICE_URL?.trim() || 'http://127.0.0.1:4105',
    riskInternalToken:
      process.env.RISK_INTERNAL_TOKEN?.trim() ||
      'local-only-risk-internal-token-change-me',
    riskPaymentsSourceToken:
      process.env.RISK_PAYMENTS_SOURCE_TOKEN?.trim() ||
      'local-only-risk-payments-source-change-me',
    riskTimeoutMs: integer('RISK_HTTP_TIMEOUT_MS', 2_000, 100),
    qrSigningKey: required('PAYMENTS_QR_SIGNING_KEY'),
    qrDynamicTtlSeconds: integer('PAYMENTS_QR_DYNAMIC_TTL_SECONDS', 300),
    qrStaticTtlHours: integer('PAYMENTS_QR_STATIC_TTL_HOURS', 8760),
    redisUrl:
      process.env.REDIS_URL?.trim() ||
      'redis://:aegis-local-redis-change-me@127.0.0.1:6379/0',
    redisKeyPrefix:
      process.env.PAYMENTS_REDIS_PREFIX?.trim() || 'aegis:payments:',
  };
  if (
    config.minTransferMinor > config.maxTransferMinor ||
    config.maxTransferMinor > config.dailyOutgoingLimitMinor
  )
    throw new Error('Payments transfer limits are inconsistent.');
  if (
    new URL(config.ledgerServiceUrl).protocol !== 'http:' &&
    new URL(config.ledgerServiceUrl).protocol !== 'https:'
  )
    throw new Error('LEDGER_SERVICE_URL must be HTTP or HTTPS.');
  if (
    config.nodeEnvironment === 'production' &&
    [
      config.internalToken,
      config.ledgerInternalToken,
      config.databaseUrl,
      config.riskInternalToken,
      config.riskPaymentsSourceToken,
      config.qrSigningKey,
    ].some((value) =>
      /change-me|local-only|placeholder|example-only/iu.test(value),
    )
  )
    throw new Error('Production Payments configuration contains placeholders.');
  return config;
}
