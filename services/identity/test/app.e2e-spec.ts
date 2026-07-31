import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { RedisService } from '../src/redis/redis.service';

describe('Identity service boundary (e2e)', () => {
  let app: INestApplication<App>;
  let initialized = false;
  const token = 'test-only-identity-internal-token';
  const originalEnvironment = { ...process.env };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.IDENTITY_INTERNAL_TOKEN = token;
    process.env.IDENTITY_REDIS_PREFIX = `aegis:identity:test:boundary:${process.pid}:`;
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({ bodyParser: false });
    configureApplication(app);
    await app.init();
    initialized = true;
  });

  it('keeps liveness public and requires the service token for readiness', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200, {
      status: 'ok',
      service: 'identity',
    });
    await request(app.getHttpServer()).get('/health/ready').expect(401);
    await request(app.getHttpServer())
      .get('/health/ready')
      .set('x-aegis-internal-token', 'incorrect-token')
      .expect(401);
  });

  it('reports real PostgreSQL and Redis readiness without secret leakage', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .set('x-aegis-internal-token', token)
      .expect(200);
    const body: unknown = response.body;
    expect(body).toEqual({
      status: 'ready',
      service: 'identity',
      dependencies: { postgres: 'up', redis: 'up' },
    });
    expect(JSON.stringify(body)).not.toMatch(
      /password|token|postgresql:\/\/|redis:\/\//iu,
    );
  });

  afterAll(async () => {
    if (initialized) {
      await app.get(RedisService).cleanupIsolatedTestPrefix();
      await app.close();
    }
    process.env = originalEnvironment;
  });
});
