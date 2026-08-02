import { createPaymentsConfig } from './payments.config';

/*
 * Startup configuration must fail loudly and safely.
 *
 * The inclusive channels added required secrets (`PAYMENTS_QR_SIGNING_KEY`,
 * and Redis settings the channels depend on). A service that silently invented
 * a default for a signing key would produce QR codes anyone could forge, so the
 * absence of a fallback is itself the security property under test here.
 *
 * dotenv is stubbed out because `createPaymentsConfig` calls
 * `loadRootEnvironment()`, which reads the repository-root `.env` at call time.
 * Without the stub a "this variable is missing" test passes on CI (no `.env`)
 * and fails on any developer machine that has one — the value would be quietly
 * restored under the test's feet.
 */
jest.mock('dotenv', () => ({ config: jest.fn() }));

/** Deterministic, obviously fake. Never real key material. */
const COMPLETE: Record<string, string> = {
  NODE_ENV: 'test',
  PAYMENTS_SERVICE_PORT: '4104',
  PAYMENTS_DATABASE_URL:
    'postgresql://aegis_payments:test-only-password@127.0.0.1:5432/aegis_payments?schema=app',
  PAYMENTS_INTERNAL_TOKEN: 'test-only-payments-internal-token',
  LEDGER_SERVICE_URL: 'http://127.0.0.1:4102',
  LEDGER_INTERNAL_TOKEN: 'test-only-ledger-internal-token',
  PAYMENTS_QR_SIGNING_KEY: 'test-only-qr-signing-key',
  PAYMENTS_QR_DYNAMIC_TTL_SECONDS: '300',
  PAYMENTS_QR_STATIC_TTL_HOURS: '8760',
  USSD_PROVIDER_SECRET: 'test-only-ussd-provider-secret',
  REDIS_URL: 'redis://127.0.0.1:6379/0',
  PAYMENTS_REDIS_PREFIX: 'aegis:payments:test:config:',
};

/**
 * A complete set of production-shaped secrets.
 *
 * Every value the production placeholder check inspects must be here, across
 * all three groups: the Payments and Ledger tokens, the channel QR signing
 * key and the Risk tokens. Omitting one lets it fall back to its
 * `local-only-…` default, which the check correctly rejects.
 */
const PRODUCTION_SECRETS: Record<string, string> = {
  PAYMENTS_INTERNAL_TOKEN: 'Zr8xQ2vLm4Np7Ks9Td1Wc6Yb3Hg5Jf0A',
  LEDGER_INTERNAL_TOKEN: 'Qw3eRt5yUi7oPa9sDf1gHj4kLz6xCv8B',
  PAYMENTS_QR_SIGNING_KEY: 'Mn2bVc4xZa6sDf8gHj0kLp3qWe5rTy7U',
  RISK_INTERNAL_TOKEN: 'Bd6fGh8jKl0mNp2qRs4tUv6wXy8zAc1E',
  RISK_PAYMENTS_SOURCE_TOKEN: 'Tk5nHj7bVc9xZq1wEr3tYu5iOp7aSd9F',
  PAYMENTS_DATABASE_URL:
    'postgresql://aegis_payments:Pw9nMk3jHb5vGc7x@db.internal:5432/aegis_payments?schema=app',
};

function withEnvironment(overrides: Record<string, string | undefined>) {
  for (const name of Object.keys(process.env)) {
    if (
      name.startsWith('PAYMENTS_') ||
      name.startsWith('USSD_') ||
      name.startsWith('LEDGER_') ||
      name.startsWith('RISK_') ||
      name === 'REDIS_URL'
    ) {
      delete process.env[name];
    }
  }
  for (const [name, value] of Object.entries({ ...COMPLETE, ...overrides })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

describe('createPaymentsConfig', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('builds a complete configuration from a complete environment', () => {
    withEnvironment({});
    const config = createPaymentsConfig();

    expect(config.qrSigningKey).toBe('test-only-qr-signing-key');
    expect(config.qrDynamicTtlSeconds).toBe(300);
    expect(config.qrStaticTtlHours).toBe(8760);
    expect(config.redisUrl).toBe('redis://127.0.0.1:6379/0');
    expect(config.redisKeyPrefix).toBe('aegis:payments:test:config:');
    expect(config.internalToken).toBe('test-only-payments-internal-token');
  });

  it('refuses to start without a QR signing key rather than inventing one', () => {
    withEnvironment({ PAYMENTS_QR_SIGNING_KEY: undefined });
    // No fallback: an invented signing key would make every QR code forgeable.
    expect(() => createPaymentsConfig()).toThrow(
      /PAYMENTS_QR_SIGNING_KEY is required/u,
    );
  });

  it('refuses to start without the internal tokens', () => {
    withEnvironment({ PAYMENTS_INTERNAL_TOKEN: undefined });
    expect(() => createPaymentsConfig()).toThrow(
      /PAYMENTS_INTERNAL_TOKEN is required/u,
    );

    withEnvironment({ LEDGER_INTERNAL_TOKEN: undefined });
    expect(() => createPaymentsConfig()).toThrow(
      /LEDGER_INTERNAL_TOKEN is required/u,
    );
  });

  it('rejects placeholder secrets in production', () => {
    withEnvironment({
      NODE_ENV: 'production',
      PAYMENTS_QR_SIGNING_KEY: 'local-only-qr-signing-key-change-me',
    });
    expect(() => createPaymentsConfig()).toThrow(/placeholders/u);
  });

  it('rejects a placeholder internal token in production', () => {
    withEnvironment({
      NODE_ENV: 'production',
      PAYMENTS_INTERNAL_TOKEN: 'local-only-payments-token-change-me',
    });
    expect(() => createPaymentsConfig()).toThrow(/placeholders/u);
  });

  it('rejects placeholder Risk tokens in production', () => {
    // Payments calls Risk on the transfer path, so a placeholder Risk token in
    // production means enforcement talks to nothing. The check covers it for
    // the same reason it covers the Ledger token.
    withEnvironment({
      NODE_ENV: 'production',
      ...PRODUCTION_SECRETS,
      RISK_INTERNAL_TOKEN: 'local-only-risk-internal-token-change-me',
    });
    expect(() => createPaymentsConfig()).toThrow(/placeholders/u);

    withEnvironment({
      NODE_ENV: 'production',
      ...PRODUCTION_SECRETS,
      RISK_PAYMENTS_SOURCE_TOKEN: 'local-only-risk-payments-source-change-me',
    });
    expect(() => createPaymentsConfig()).toThrow(/placeholders/u);
  });

  it('accepts real-looking secrets in production', () => {
    withEnvironment({ NODE_ENV: 'production', ...PRODUCTION_SECRETS });
    expect(() => createPaymentsConfig()).not.toThrow();
  });

  it('defaults the Redis namespace rather than sharing a bare keyspace', () => {
    withEnvironment({ PAYMENTS_REDIS_PREFIX: undefined });
    const config = createPaymentsConfig();
    expect(config.redisKeyPrefix).toBe('aegis:payments:');
  });

  it('rejects inconsistent transfer limits', () => {
    withEnvironment({
      PAYMENTS_MIN_TRANSFER_MINOR: '900000',
      PAYMENTS_MAX_TRANSFER_MINOR: '1000',
    });
    expect(() => createPaymentsConfig()).toThrow(/limits are inconsistent/u);
  });

  it('rejects a non-HTTP Ledger URL', () => {
    withEnvironment({ LEDGER_SERVICE_URL: 'file:///etc/passwd' });
    expect(() => createPaymentsConfig()).toThrow(/HTTP or HTTPS/u);
  });

  it('rejects invalid numeric settings instead of coercing them', () => {
    withEnvironment({ PAYMENTS_QR_DYNAMIC_TTL_SECONDS: 'soon' });
    expect(() => createPaymentsConfig()).toThrow(
      /PAYMENTS_QR_DYNAMIC_TTL_SECONDS is invalid/u,
    );
  });
});
