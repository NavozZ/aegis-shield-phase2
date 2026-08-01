import { config as loadEnvironment } from 'dotenv';
import { resolve } from 'node:path';

export interface GatewayConfig {
  nodeEnvironment: string;
  identityServiceUrl: string;
  identityInternalToken: string;
  ledgerServiceUrl: string;
  ledgerInternalToken: string;
  paymentsServiceUrl: string;
  paymentsInternalToken: string;
  riskServiceUrl: string;
  riskInternalToken: string;
  riskGatewaySourceToken: string;
  sessionCookieName: string;
  csrfCookieName: string;
  identityTimeoutMs: number;
  ledgerTimeoutMs: number;
  paymentsTimeoutMs: number;
  riskTimeoutMs: number;
  operatorSessionCookieName: string;
  operatorCsrfCookieName: string;
  /** Blind router base URL. Server-side only; never sent to a browser. */
  sabclRouterUrl: string;
  sabclTimeoutMs: number;
  resilienceServiceUrl: string;
  /**
   * The gateway's own source token for the Resilience service. It is not the
   * resilience internal token: the gateway is one caller among several and gets
   * the credential matched to its role, so a leaked gateway token cannot be
   * replayed as operator tooling.
   */
  resilienceGatewaySourceToken: string;
  resilienceTimeoutMs: number;
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
    ledgerServiceUrl:
      process.env.LEDGER_SERVICE_URL?.trim() || 'http://127.0.0.1:4102',
    ledgerInternalToken: requiredSetting('LEDGER_INTERNAL_TOKEN'),
    paymentsServiceUrl:
      process.env.PAYMENTS_SERVICE_URL?.trim() || 'http://127.0.0.1:4104',
    paymentsInternalToken: requiredSetting('PAYMENTS_INTERNAL_TOKEN'),
    riskServiceUrl:
      process.env.RISK_SERVICE_URL?.trim() || 'http://127.0.0.1:4105',
    riskInternalToken:
      process.env.RISK_INTERNAL_TOKEN?.trim() ||
      'local-only-risk-internal-token-change-me',
    riskGatewaySourceToken:
      process.env.RISK_GATEWAY_SOURCE_TOKEN?.trim() ||
      'local-only-risk-gateway-source-change-me',
    sessionCookieName:
      process.env.AUTH_SESSION_COOKIE_NAME?.trim() || 'aegis_session',
    csrfCookieName: process.env.AUTH_CSRF_COOKIE_NAME?.trim() || 'aegis_csrf',
    operatorSessionCookieName: 'aegis_operator_session',
    operatorCsrfCookieName: 'aegis_operator_csrf',
    identityTimeoutMs: integerSetting('IDENTITY_HTTP_TIMEOUT_MS', 3_000),
    ledgerTimeoutMs: integerSetting('LEDGER_HTTP_TIMEOUT_MS', 5_000),
    paymentsTimeoutMs: integerSetting('PAYMENTS_HTTP_TIMEOUT_MS', 5_000),
    riskTimeoutMs: integerSetting('RISK_HTTP_TIMEOUT_MS', 2_000),
    sabclRouterUrl:
      process.env.SABCL_ROUTER_URL?.trim() || 'http://127.0.0.1:4103',
    // The router adds a hop, so its budget is the upstream budget plus headroom
    // rather than the same number.
    sabclTimeoutMs: integerSetting('SABCL_HTTP_TIMEOUT_MS', 8_000),
    resilienceServiceUrl:
      process.env.RESILIENCE_SERVICE_URL?.trim() || 'http://127.0.0.1:4106',
    resilienceGatewaySourceToken:
      process.env.RESILIENCE_GATEWAY_SOURCE_TOKEN?.trim() ||
      'local-only-resilience-gateway-source-change-me',
    // The readiness document fans out to dependency probes, so it is given more
    // headroom than a single-hop risk call while staying bounded.
    resilienceTimeoutMs: integerSetting('RESILIENCE_HTTP_TIMEOUT_MS', 4_000),
  };

  for (const [name, value] of [
    ['IDENTITY_SERVICE_URL', configuration.identityServiceUrl],
    ['LEDGER_SERVICE_URL', configuration.ledgerServiceUrl],
    ['PAYMENTS_SERVICE_URL', configuration.paymentsServiceUrl],
    ['RISK_SERVICE_URL', configuration.riskServiceUrl],
    ['SABCL_ROUTER_URL', configuration.sabclRouterUrl],
    ['RESILIENCE_SERVICE_URL', configuration.resilienceServiceUrl],
  ] as const) {
    if (!['http:', 'https:'].includes(new URL(value).protocol)) {
      throw new Error(`${name} must use HTTP or HTTPS.`);
    }
  }
  if (configuration.nodeEnvironment === 'production') {
    const placeholders = (
      [
        ['IDENTITY_INTERNAL_TOKEN', configuration.identityInternalToken],
        ['LEDGER_INTERNAL_TOKEN', configuration.ledgerInternalToken],
        ['PAYMENTS_INTERNAL_TOKEN', configuration.paymentsInternalToken],
        ['RISK_INTERNAL_TOKEN', configuration.riskInternalToken],
        ['RISK_GATEWAY_SOURCE_TOKEN', configuration.riskGatewaySourceToken],
        [
          'RESILIENCE_GATEWAY_SOURCE_TOKEN',
          configuration.resilienceGatewaySourceToken,
        ],
      ] as const
    ).filter(([, value]) => /change-me|local-only|placeholder/iu.test(value));
    if (placeholders.length > 0) {
      throw new Error(
        `${placeholders.map(([name]) => name).join(' and ')} must be configured in production.`,
      );
    }
  }
  return configuration;
}
