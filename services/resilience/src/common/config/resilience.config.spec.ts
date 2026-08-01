import { createResilienceConfig } from './resilience.config';

/*
 * Startup configuration must fail loudly.
 *
 * A resilience service that started with a placeholder token or an unusable
 * backup key would report recovery readiness it cannot support, which is worse
 * than not starting.
 *
 * dotenv is stubbed because `createResilienceConfig` reads the repository-root
 * `.env` at call time; without the stub a "this is missing" test passes in CI
 * and fails on any machine that has one.
 */
jest.mock('dotenv', () => ({ config: jest.fn() }));

const COMPLETE: Record<string, string> = {
  NODE_ENV: 'test',
  RESILIENCE_SERVICE_PORT: '4106',
  RESILIENCE_DATABASE_URL:
    'postgresql://aegis_resilience:test-only-password@127.0.0.1:5432/aegis_resilience?schema=app',
  RESILIENCE_INTERNAL_TOKEN: 'test-only-resilience-internal-token',
  RESILIENCE_GATEWAY_SOURCE_TOKEN: 'test-only-resilience-gateway-source',
  RESILIENCE_TOOLING_SOURCE_TOKEN: 'test-only-resilience-tooling-source',
  DR_BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
  IDENTITY_SERVICE_URL: 'http://127.0.0.1:4101',
  LEDGER_SERVICE_URL: 'http://127.0.0.1:4102',
  PAYMENTS_SERVICE_URL: 'http://127.0.0.1:4104',
  RISK_SERVICE_URL: 'http://127.0.0.1:4105',
};

function withEnvironment(overrides: Record<string, string | undefined>) {
  for (const name of Object.keys(process.env)) {
    if (
      name.startsWith('RESILIENCE_') ||
      name.startsWith('DR_') ||
      name.endsWith('_SERVICE_URL')
    ) {
      delete process.env[name];
    }
  }
  for (const [name, value] of Object.entries({ ...COMPLETE, ...overrides })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

describe('createResilienceConfig', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it('builds a configuration from a complete environment', () => {
    withEnvironment({});
    const config = createResilienceConfig();
    expect(config.port).toBe(4106);
    expect(config.internalToken).toBe('test-only-resilience-internal-token');
    expect(config.sourceTokens.GATEWAY).toBe(
      'test-only-resilience-gateway-source',
    );
    expect(config.backupKeyConfigured).toBe(true);
    expect(config.dependencies.map((item) => item.name)).toEqual([
      'identity',
      'ledger',
      'payments',
      'risk',
    ]);
  });

  it('never places the backup key on the configuration object', () => {
    withEnvironment({});
    const config = createResilienceConfig();
    // The service records evidence about backups; only the CLI ever holds the
    // key. Serialising the config must not disclose it.
    expect(JSON.stringify(config)).not.toContain(
      COMPLETE.DR_BACKUP_ENCRYPTION_KEY,
    );
    expect(Object.values(config)).not.toContain(
      COMPLETE.DR_BACKUP_ENCRYPTION_KEY,
    );
  });

  it('requires each internal and source token', () => {
    for (const name of [
      'RESILIENCE_INTERNAL_TOKEN',
      'RESILIENCE_GATEWAY_SOURCE_TOKEN',
      'RESILIENCE_TOOLING_SOURCE_TOKEN',
    ]) {
      withEnvironment({ [name]: undefined });
      expect(() => createResilienceConfig()).toThrow(
        new RegExp(`${name} is required`, 'u'),
      );
    }
  });

  it('rejects a weak or malformed backup key rather than stretching it', () => {
    for (const bad of [
      Buffer.alloc(16, 5).toString('base64'),
      Buffer.alloc(32).toString('base64'),
      'not base64 !!',
    ]) {
      withEnvironment({ DR_BACKUP_ENCRYPTION_KEY: bad });
      expect(() => createResilienceConfig()).toThrow(/KEY_INVALID/u);
    }
  });

  it('allows an absent backup key outside production but requires one in production', () => {
    withEnvironment({ DR_BACKUP_ENCRYPTION_KEY: undefined });
    expect(createResilienceConfig().backupKeyConfigured).toBe(false);

    withEnvironment({
      NODE_ENV: 'production',
      DR_BACKUP_ENCRYPTION_KEY: undefined,
      RESILIENCE_INTERNAL_TOKEN: 'Zr8xQ2vLm4Np7Ks9Td1Wc6Yb3Hg5Jf0A',
      RESILIENCE_GATEWAY_SOURCE_TOKEN: 'Qw3eRt5yUi7oPa9sDf1gHj4kLz6xCv8B',
      RESILIENCE_TOOLING_SOURCE_TOKEN: 'Mn2bVc4xZa6sDf8gHj0kLp3qWe5rTy7U',
      RESILIENCE_DATABASE_URL:
        'postgresql://aegis_resilience:Pw9nMk3jHb5vGc7x@db.internal:5432/aegis_resilience?schema=app',
    });
    expect(() => createResilienceConfig()).toThrow(
      /DR_BACKUP_ENCRYPTION_KEY is required in production/u,
    );
  });

  it('refuses placeholder secrets in production', () => {
    withEnvironment({
      NODE_ENV: 'production',
      RESILIENCE_INTERNAL_TOKEN: 'local-only-resilience-token-change-me',
    });
    expect(() => createResilienceConfig()).toThrow(
      /must be configured in production/u,
    );
  });

  it('refuses a placeholder database URL in production', () => {
    withEnvironment({
      NODE_ENV: 'production',
      RESILIENCE_INTERNAL_TOKEN: 'Zr8xQ2vLm4Np7Ks9Td1Wc6Yb3Hg5Jf0A',
      RESILIENCE_GATEWAY_SOURCE_TOKEN: 'Qw3eRt5yUi7oPa9sDf1gHj4kLz6xCv8B',
      RESILIENCE_TOOLING_SOURCE_TOKEN: 'Mn2bVc4xZa6sDf8gHj0kLp3qWe5rTy7U',
      RESILIENCE_DATABASE_URL:
        'postgresql://aegis_resilience:aegis-local-resilience-change-me@127.0.0.1:5432/aegis_resilience?schema=app',
    });
    expect(() => createResilienceConfig()).toThrow(
      /RESILIENCE_DATABASE_URL must be configured in production/u,
    );
  });

  it('rejects a non-HTTP dependency URL and an invalid port', () => {
    withEnvironment({ RISK_SERVICE_URL: 'file:///etc/passwd' });
    expect(() => createResilienceConfig()).toThrow(/must be HTTP or HTTPS/u);

    withEnvironment({ RESILIENCE_SERVICE_PORT: '70000' });
    expect(() => createResilienceConfig()).toThrow(
      /RESILIENCE_SERVICE_PORT is invalid/u,
    );
  });
});
