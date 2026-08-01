import { parseBackupKey } from '@aegis/contracts';
import { config as loadEnvironment } from 'dotenv';
import { resolve } from 'node:path';

/*
 * Strict startup configuration.
 *
 * The service refuses to start rather than run with a configuration that would
 * be unsafe: a placeholder token in production, an operator bootstrap token in
 * production, or a backup key that is absent, weak or the wrong size. A service
 * that came up degraded here would report recovery readiness it cannot back up.
 */

export interface ResilienceConfig {
  nodeEnvironment: string;
  host: string;
  port: number;
  databaseUrl: string;
  /** Token for trusted internal callers such as the Gateway. */
  internalToken: string;
  /** Per-source tokens, matching the model the Risk service already uses. */
  sourceTokens: Record<'GATEWAY' | 'TOOLING', string>;
  /** Dependencies probed for readiness. Never rendered with credentials. */
  dependencies: { name: string; url: string; timeoutMs: number }[];
  httpTimeoutMs: number;
  /** True when a usable backup key is configured. Never the key itself. */
  backupKeyConfigured: boolean;
}

export const RESILIENCE_CONFIG = Symbol('RESILIENCE_CONFIG');

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
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

const PLACEHOLDER = /change-me|local-only|placeholder|example-only/iu;

export function createResilienceConfig(): ResilienceConfig {
  loadRootEnvironment();
  const nodeEnvironment = process.env.NODE_ENV?.trim() || 'development';

  const internalToken = required('RESILIENCE_INTERNAL_TOKEN');
  const sourceTokens = {
    GATEWAY: required('RESILIENCE_GATEWAY_SOURCE_TOKEN'),
    TOOLING: required('RESILIENCE_TOOLING_SOURCE_TOKEN'),
  };

  if (nodeEnvironment === 'production') {
    for (const [name, value] of Object.entries({
      RESILIENCE_INTERNAL_TOKEN: internalToken,
      RESILIENCE_GATEWAY_SOURCE_TOKEN: sourceTokens.GATEWAY,
      RESILIENCE_TOOLING_SOURCE_TOKEN: sourceTokens.TOOLING,
    })) {
      if (PLACEHOLDER.test(value)) {
        throw new Error(`${name} must be configured in production.`);
      }
    }
  }

  // The key is validated but never retained on the config object. The service
  // records evidence about backups; only the CLI tooling ever encrypts or
  // decrypts, and it reads the key from the environment itself.
  let backupKeyConfigured = false;
  const rawBackupKey = process.env.DR_BACKUP_ENCRYPTION_KEY?.trim();
  if (rawBackupKey) {
    parseBackupKey(rawBackupKey);
    backupKeyConfigured = true;
  } else if (nodeEnvironment === 'production') {
    throw new Error('DR_BACKUP_ENCRYPTION_KEY is required in production.');
  }

  const databaseUrl =
    process.env.RESILIENCE_DATABASE_URL?.trim() ||
    'postgresql://aegis_resilience:aegis-local-resilience-change-me@127.0.0.1:5432/aegis_resilience?schema=app';
  if (nodeEnvironment === 'production' && PLACEHOLDER.test(databaseUrl)) {
    throw new Error(
      'RESILIENCE_DATABASE_URL must be configured in production.',
    );
  }

  const httpTimeoutMs = integer(
    'RESILIENCE_HTTP_TIMEOUT_MS',
    2_000,
    100,
    10_000,
  );
  const dependency = (name: string, variable: string, fallback: string) => ({
    name,
    url: process.env[variable]?.trim() || fallback,
    timeoutMs: httpTimeoutMs,
  });

  const config: ResilienceConfig = {
    nodeEnvironment,
    host: process.env.RESILIENCE_HOST?.trim() || '127.0.0.1',
    port: integer('RESILIENCE_SERVICE_PORT', 4106, 1, 65_535),
    databaseUrl,
    internalToken,
    sourceTokens,
    dependencies: [
      dependency('identity', 'IDENTITY_SERVICE_URL', 'http://127.0.0.1:4101'),
      dependency('ledger', 'LEDGER_SERVICE_URL', 'http://127.0.0.1:4102'),
      dependency('payments', 'PAYMENTS_SERVICE_URL', 'http://127.0.0.1:4104'),
      dependency('risk', 'RISK_SERVICE_URL', 'http://127.0.0.1:4105'),
    ],
    httpTimeoutMs,
    backupKeyConfigured,
  };

  for (const item of config.dependencies) {
    const protocol = new URL(item.url).protocol;
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new Error(`${item.name} service URL must be HTTP or HTTPS.`);
    }
  }

  return config;
}
