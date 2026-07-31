import { HealthController } from './health.controller';

describe('Identity HealthController', () => {
  it.each([
    [true, true, 200, 'ready'],
    [false, true, 503, 'not_ready'],
    [true, false, 503, 'not_ready'],
  ] as const)(
    'reports postgres=%s redis=%s without leaking configuration',
    async (postgres, redis, status, expectedStatus) => {
      const controller = new HealthController(
        { isHealthy: jest.fn().mockResolvedValue(postgres) } as never,
        { ping: jest.fn().mockResolvedValue(redis) } as never,
      );
      const response = { status: jest.fn() };
      const result = await controller.ready(response as never);
      expect(response.status).toHaveBeenCalledWith(status);
      expect(result.status).toBe(expectedStatus);
      expect(JSON.stringify(result)).not.toMatch(
        /password|token|postgresql:\/\/|redis:\/\//iu,
      );
    },
  );

  it('keeps liveness independent of dependencies', () => {
    const controller = new HealthController({} as never, {} as never);
    expect(controller.live()).toEqual({ status: 'ok', service: 'identity' });
  });
});
