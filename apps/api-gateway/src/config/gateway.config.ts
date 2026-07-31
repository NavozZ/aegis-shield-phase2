import { config as loadEnvironment } from 'dotenv';
import { resolve } from 'node:path';

export interface GatewayConfig {
  nodeEnvironment: string;
  identityServiceUrl: string;
  identityInternalToken: string;
  sessionCookieName: string;
  csrfCookieName: string;
  identityTimeoutMs: number;
}

export const GATEWAY_CONFIG = Symbol('GATEWAY_CONFIG');

function integerSetting(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 100 || value > 10_000) {
    throw new Error(`${name} must be an integer between 100 and 10000.`);
  }
  return value;
}

function requiredSetting(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function createGatewayConfig(): GatewayConfig {
  loadEnvironment({
    path: resolve(process.cwd(), '..', '..', '.env'),
    quiet: true,
  });
  const configuration: GatewayConfig = {
    nodeEnvironment: process.env.NODE_ENV?.trim() || 'development',
    identityServiceUrl:
      process.env.IDENTITY_SERVICE_URL?.trim() || 'http://127.0.0.1:4101',
    identityInternalToken: requiredSetting('IDENTITY_INTERNAL_TOKEN'),
    sessionCookieName:
      process.env.AUTH_SESSION_COOKIE_NAME?.trim() || 'aegis_session',
    csrfCookieName: process.env.AUTH_CSRF_COOKIE_NAME?.trim() || 'aegis_csrf',
    identityTimeoutMs: integerSetting('IDENTITY_HTTP_TIMEOUT_MS', 3_000),
  };

  const parsedIdentityUrl = new URL(configuration.identityServiceUrl);
  if (!['http:', 'https:'].includes(parsedIdentityUrl.protocol)) {
    throw new Error('IDENTITY_SERVICE_URL must use HTTP or HTTPS.');
  }
  if (
    configuration.nodeEnvironment === 'production' &&
    /change-me|local-only|placeholder/iu.test(
      configuration.identityInternalToken,
    )
  ) {
    throw new Error(
      'IDENTITY_INTERNAL_TOKEN must be configured in production.',
    );
  }
  return configuration;
}
