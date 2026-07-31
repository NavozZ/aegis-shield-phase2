import { HealthController } from './health.controller';

describe('HealthController', () => {
  const identity = { ready: jest.fn().mockResolvedValue(true) };
  const controller = new HealthController(identity as never);
  const originalNodeEnvironment = process.env.NODE_ENV;

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

  it('reports readiness only when Identity is ready', async () => {
    await expect(controller.getReadiness()).resolves.toEqual({
      status: 'ready',
      dependencies: { identity: 'up' },
    });
    identity.ready.mockResolvedValueOnce(false);
    await expect(controller.getReadiness()).rejects.toMatchObject({
      status: 503,
    });
  });
});
