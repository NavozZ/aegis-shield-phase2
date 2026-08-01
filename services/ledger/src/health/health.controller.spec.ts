import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import request from 'supertest';
import { PrismaService } from '../database/prisma.service';
import { HealthController } from './health.controller';

function responseStub() {
  const status = jest.fn();
  return { response: { status } as unknown as Response, status };
}

describe('HealthController', () => {
  it('reports liveness without touching the database', () => {
    const isHealthy = jest.fn();
    const controller = new HealthController({
      isHealthy,
    } as unknown as PrismaService);

    expect(controller.live()).toEqual({ status: 'ok', service: 'ledger' });
    expect(isHealthy).not.toHaveBeenCalled();
  });

  it('serves the same liveness payload on /health and /health/live', () => {
    const controller = new HealthController({
      isHealthy: jest.fn(),
    } as unknown as PrismaService);

    expect(controller.health()).toEqual(controller.live());
  });

  it('reports ready when PostgreSQL responds', async () => {
    const { response, status } = responseStub();
    const controller = new HealthController({
      isHealthy: jest.fn(() => Promise.resolve(true)),
    } as unknown as PrismaService);

    await expect(controller.ready(response)).resolves.toEqual({
      status: 'ready',
      service: 'ledger',
      dependencies: { postgres: 'up' },
    });
    expect(status).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it('reports service unavailable when PostgreSQL is down', async () => {
    const { response, status } = responseStub();
    const controller = new HealthController({
      isHealthy: jest.fn(() => Promise.resolve(false)),
    } as unknown as PrismaService);

    await expect(controller.ready(response)).resolves.toMatchObject({
      status: 'not_ready',
      dependencies: { postgres: 'down' },
    });
    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });
});

/**
 * Routing is asserted through a real Nest application because a controller
 * method can look correct while its route is never registered: two `@Get`
 * decorators on one method silently keep only the outermost path.
 */
describe('health routing', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaService,
          useValue: { isHealthy: () => Promise.resolve(true) },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['/health', '/health/live'])('registers %s', async (path) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await request(app.getHttpServer())
      .get(path)
      .expect(200, { status: 'ok', service: 'ledger' });
  });

  it('registers the readiness route', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await request(app.getHttpServer()).get('/health/ready').expect(200);
  });
});
