import { Logger } from '@nestjs/common';
import { config as loadEnvironment } from 'dotenv';
import { resolve } from 'node:path';

export interface IdentityConfig {
  nodeEnvironment: string;
  host: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  redisKeyPrefix: string;
  internalToken: string;
  sessionCookieName: string;
  csrfCookieName: string;
  sessionIdleTtlSeconds: number;
  sessionAbsoluteTtlSeconds: number;
  otpTtlSeconds: number;
  otpResendCooldownSeconds: number;
  otpMaxAttempts: number;
  otpRequestLimitPerHour: number;
  demoAuthEnabled: boolean;
  webauthnRpName: string;
  webauthnRpId: string;
  webauthnOrigin: string;
  fieldEncryptionKey: string;
}

export const IDENTITY_CONFIG = Symbol('IDENTITY_CONFIG');

const localDatabaseUrl =
  'postgresql://aegis_identity:aegis-local-identity-change-me@127.0.0.1:5432/aegis_identity?schema=app';
const localRedisUrl = 'redis://:aegis-local-redis-change-me@127.0.0.1:6379/0';

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

function booleanSetting(name: string, fallback: boolean): boolean {
  const rawValue = process.env[name]?.trim().toLowerCase();
  if (!rawValue) return fallback;
  if (rawValue === 'true') return true;
  if (rawValue === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function requiredSetting(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function validateProductionSecrets(config: IdentityConfig): void {
  if (config.nodeEnvironment !== 'production') return;

  const secretSettings: Array<[string, string]> = [
    ['IDENTITY_INTERNAL_TOKEN', config.internalToken],
    ['IDENTITY_DATABASE_URL', config.databaseUrl],
    ['REDIS_URL', config.redisUrl],
    ['FIELD_ENCRYPTION_KEY', config.fieldEncryptionKey],
  ];
  const unsafeValues = secretSettings.filter(([, value]) =>
    /change-me|local-only|placeholder|example-only|BASE64_LOCAL_ONLY/iu.test(
      value,
    ),
  );

  if (unsafeValues.length > 0 || config.demoAuthEnabled) {
    throw new Error(
      'Production authentication configuration contains local placeholders or demo authentication is enabled.',
    );
  }
}

export function createIdentityConfig(): IdentityConfig {
  loadRootEnvironment();
  const config: IdentityConfig = {
    nodeEnvironment: process.env.NODE_ENV?.trim() || 'development',
    host: process.env.IDENTITY_HOST?.trim() || '127.0.0.1',
    port: integerSetting('IDENTITY_PORT', 4101),
    databaseUrl: process.env.IDENTITY_DATABASE_URL?.trim() || localDatabaseUrl,
    redisUrl: process.env.REDIS_URL?.trim() || localRedisUrl,
    redisKeyPrefix:
      process.env.IDENTITY_REDIS_PREFIX?.trim() || 'aegis:identity:',
    internalToken: requiredSetting('IDENTITY_INTERNAL_TOKEN'),
    sessionCookieName:
      process.env.AUTH_SESSION_COOKIE_NAME?.trim() || 'aegis_session',
    csrfCookieName: process.env.AUTH_CSRF_COOKIE_NAME?.trim() || 'aegis_csrf',
    sessionIdleTtlSeconds: integerSetting('AUTH_SESSION_IDLE_TTL_SECONDS', 900),
    sessionAbsoluteTtlSeconds: integerSetting(
      'AUTH_SESSION_ABSOLUTE_TTL_SECONDS',
      28_800,
    ),
    otpTtlSeconds: integerSetting('OTP_TTL_SECONDS', 300),
    otpResendCooldownSeconds: integerSetting('OTP_RESEND_COOLDOWN_SECONDS', 60),
    otpMaxAttempts: integerSetting('OTP_MAX_ATTEMPTS', 5),
    otpRequestLimitPerHour: integerSetting('OTP_REQUEST_LIMIT_PER_HOUR', 5),
    demoAuthEnabled: booleanSetting('DEMO_AUTH_ENABLED', false),
    webauthnRpName: process.env.WEBAUTHN_RP_NAME?.trim() || 'AEGIS Shield',
    webauthnRpId: process.env.WEBAUTHN_RP_ID?.trim() || 'localhost',
    webauthnOrigin:
      process.env.WEBAUTHN_ORIGIN?.trim() || 'http://localhost:3000',
    fieldEncryptionKey:
      process.env.FIELD_ENCRYPTION_KEY?.trim() ||
      'BASE64_LOCAL_ONLY_32_BYTE_KEY_PLACEHOLDER',
  };

  if (config.sessionAbsoluteTtlSeconds < config.sessionIdleTtlSeconds) {
    throw new Error(
      'AUTH_SESSION_ABSOLUTE_TTL_SECONDS must not be shorter than the idle TTL.',
    );
  }
  if (!/^aegis:identity:[a-zA-Z0-9:_-]*$/u.test(config.redisKeyPrefix)) {
    throw new Error('IDENTITY_REDIS_PREFIX must begin with aegis:identity:.');
  }
  validateProductionSecrets(config);

  if (config.nodeEnvironment !== 'production') {
    Logger.warn(
      'Identity is using local-development authentication configuration; never use it with real users.',
      'IdentityConfig',
    );
  }
  return config;
}
