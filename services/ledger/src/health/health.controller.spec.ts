import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import type { PrismaService } from '../database/prisma.service';
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
