import { config as loadEnvironment } from 'dotenv';
import { resolve } from 'node:path';

export interface RiskConfig {
  host: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  internalToken: string;
  sourceTokens: Record<string, string>;
  redisPrefix: string;
  retentionDays: number;
  assessmentTtlSeconds: number;
  staleSourceSeconds: number;
  operatorBootstrapToken?: string;
  operatorSessionTtlSeconds: number;
  highValueMinor: bigint;
  cumulativeValueMinor: bigint;
  identityServiceUrl: string;
  identityInternalToken: string;
  identityTimeoutMs: number;
}
export const RISK_CONFIG = Symbol('RISK_CONFIG');
export function loadRootEnvironment(): void {
  loadEnvironment({
    path: resolve(process.cwd(), '..', '..', '.env'),
    quiet: true,
  });
}
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
function integer(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${name} is invalid.`);
  return value;
}
export function createRiskConfig(): RiskConfig {
  loadRootEnvironment();
  const nodeEnvironment = process.env.NODE_ENV?.trim() || 'development';
  const operatorBootstrapToken =
    process.env.RISK_OPERATOR_BOOTSTRAP_TOKEN?.trim();
  if (nodeEnvironment === 'production' && operatorBootstrapToken)
    throw new Error(
      'RISK_OPERATOR_BOOTSTRAP_TOKEN must not be configured in production.',
    );
  const internalToken = required('RISK_INTERNAL_TOKEN');
  const sourceTokens = {
    GATEWAY: required('RISK_GATEWAY_SOURCE_TOKEN'),
    IDENTITY: required('RISK_IDENTITY_SOURCE_TOKEN'),
    PAYMENTS: required('RISK_PAYMENTS_SOURCE_TOKEN'),
    LEDGER: required('RISK_LEDGER_SOURCE_TOKEN'),
    INFRASTRUCTURE: required('RISK_INFRASTRUCTURE_SOURCE_TOKEN'),
    CHANNEL_ADAPTER: required('RISK_CHANNEL_SOURCE_TOKEN'),
  };
  if (nodeEnvironment === 'production')
    for (const [name, value] of Object.entries({
      RISK_INTERNAL_TOKEN: internalToken,
      ...sourceTokens,
    }))
      if (/change-me|local-only|placeholder/iu.test(value))
        throw new Error(`${name} must be configured in production.`);
  return {
    host: process.env.RISK_HOST?.trim() || '127.0.0.1',
    port: integer('RISK_SERVICE_PORT', 4105, 1, 65535),
    databaseUrl: required('RISK_DATABASE_URL'),
    redisUrl: required('REDIS_URL'),
    internalToken,
    sourceTokens,
    redisPrefix: process.env.RISK_REDIS_PREFIX?.trim() || 'aegis:risk:',
    retentionDays: integer('RISK_EVENT_RETENTION_DAYS', 90, 1, 365),
    assessmentTtlSeconds: integer('RISK_ASSESSMENT_TTL_SECONDS', 300, 30, 3600),
    staleSourceSeconds: integer('RISK_SOURCE_STALE_SECONDS', 900, 60, 86400),
    operatorBootstrapToken,
    operatorSessionTtlSeconds: integer(
      'RISK_OPERATOR_SESSION_TTL_SECONDS',
      1800,
      300,
      3600,
    ),
    highValueMinor: BigInt(process.env.RISK_HIGH_VALUE_MINOR || '10000000'),
    cumulativeValueMinor: BigInt(
      process.env.RISK_CUMULATIVE_VALUE_MINOR || '25000000',
    ),
    identityServiceUrl:
      process.env.IDENTITY_SERVICE_URL?.trim() || 'http://127.0.0.1:4101',
    identityInternalToken: required('IDENTITY_INTERNAL_TOKEN'),
    identityTimeoutMs: integer('IDENTITY_HTTP_TIMEOUT_MS', 3_000, 100, 10_000),
  };
}
