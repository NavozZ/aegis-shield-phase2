import { HealthController } from './health.controller';

describe('HealthController', () => {
  const identity = { ready: jest.fn().mockResolvedValue(true) };
  const ledger = { ready: jest.fn().mockResolvedValue(true) };
  const payments = { ready: jest.fn().mockResolvedValue(true) };
  const controller = new HealthController(
    identity as never,
    ledger as never,
    payments as never,
  );
  const originalNodeEnvironment = process.env.NODE_ENV;

  beforeEach(() => {
    identity.ready.mockResolvedValue(true);
    ledger.ready.mockResolvedValue(true);
    payments.ready.mockResolvedValue(true);
  });

  afterEach(() => {
    if (originalNodeEnvironment === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnvironment;
    }
  });

  it('returns the API gateway health contract with a valid timestamp', () => {
    const response = controller.getHealth();

    expect(response.status).toBe('ok');
    expect(response.service).toBe('api-gateway');
    expect(response.version).toBe('0.1.0');
    expect(response.environment).toBe(
      process.env.NODE_ENV?.trim() || 'development',
    );
    expect(new Date(response.timestamp).toISOString()).toBe(response.timestamp);
  });

  it('uses development when NODE_ENV is empty', () => {
    process.env.NODE_ENV = '';

    expect(controller.getHealth().environment).toBe('development');
  });

  it('reports readiness when all dependencies are ready', async () => {
    await expect(controller.getReadiness()).resolves.toEqual({
      status: 'ready',
      dependencies: { identity: 'up', ledger: 'up', payments: 'up' },
    });
  });

  it('fails readiness when Identity is unavailable', async () => {
    identity.ready.mockResolvedValue(false);
    await expect(controller.getReadiness()).rejects.toMatchObject({
      status: 503,
    });
  });

  it('fails readiness when the Ledger is unavailable', async () => {
    ledger.ready.mockResolvedValue(false);
    await expect(controller.getReadiness()).rejects.toMatchObject({
      status: 503,
    });
  });

  it('fails readiness when Payments is unavailable', async () => {
    payments.ready.mockResolvedValue(false);
    await expect(controller.getReadiness()).rejects.toMatchObject({
      status: 503,
    });
  });
});
