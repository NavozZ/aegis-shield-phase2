import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import type { HealthResponse } from '../src/health/health.types';

function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    value.status === 'ok' &&
    'service' in value &&
    typeof value.service === 'string' &&
    'version' in value &&
    typeof value.version === 'string' &&
    'timestamp' in value &&
    typeof value.timestamp === 'string' &&
    'environment' in value &&
    typeof value.environment === 'string'
  );
}

describe('Health endpoint (e2e)', () => {
  let app: INestApplication<App>;
  const originalNodeEnvironment = process.env.NODE_ENV;
  const originalInternalToken = process.env.IDENTITY_INTERNAL_TOKEN;

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    process.env.IDENTITY_INTERNAL_TOKEN = 'test-only-health-internal-token';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApplication(app);
    await app.init();
  });

  it('GET /health responds with HTTP 200 and the public health contract', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);
    const body: unknown = response.body;

    expect(isHealthResponse(body)).toBe(true);
    if (!isHealthResponse(body)) {
      throw new Error('Health endpoint returned an invalid response shape.');
    }

    expect(body).toMatchObject({
      status: 'ok',
      service: 'api-gateway',
      version: '0.1.0',
      environment: 'development',
    });
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  afterAll(async () => {
    await app.close();
    if (originalNodeEnvironment === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnvironment;
    }
    if (originalInternalToken === undefined) {
      delete process.env.IDENTITY_INTERNAL_TOKEN;
    } else {
      process.env.IDENTITY_INTERNAL_TOKEN = originalInternalToken;
    }
  });
});
