import type { OtpAcceptedResponse } from '@aegis/contracts';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type ChildProcess, spawn } from 'node:child_process';
import { config as loadEnvironment } from 'dotenv';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { createClient } from 'redis';
import request, { type Response as SupertestResponse } from 'supertest';
import type { App } from 'supertest/types';
import { AppModule as GatewayAppModule } from '../src/app.module';
import { configureApplication as configureGateway } from '../src/app.setup';
import {
  GATEWAY_CONFIG,
  type GatewayConfig,
} from '../src/config/gateway.config';

function cookiesFrom(response: SupertestResponse): string[] {
  const cookies = response.headers['set-cookie'];
  if (!Array.isArray(cookies)) throw new Error('Expected browser cookies.');
  return cookies;
}

function cookieHeader(cookies: string[]): string {
  return cookies.map((cookie) => cookie.split(';', 1)[0]).join('; ');
}

function cookieValue(cookies: string[], name: string): string {
  const cookie = cookies.find((candidate) => candidate.startsWith(`${name}=`));
  if (!cookie) throw new Error(`Expected ${name} cookie.`);
  return decodeURIComponent(cookie.split(';', 1)[0].slice(name.length + 1));
}

function bodyAs<T>(response: SupertestResponse): T {
  const body: unknown = response.body;
  return body as T;
}

interface EnrollmentBody {
  enrollmentToken: string;
}

interface ChallengeBody {
  challenge: string;
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Could not allocate a test port.');
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return address.port;
}

async function waitForIdentity(
  url: string,
  child: ChildProcess,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null)
      throw new Error('Identity exited during test startup.');
    try {
      const response = await fetch(`${url}/health/live`);
      if (response.ok) return;
    } catch {
      // The service may still be binding its loopback listener.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Identity did not become live within twenty seconds.');
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  const exited = await new Promise<boolean>((resolveExit) => {
    const timeout = setTimeout(() => resolveExit(false), 3_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolveExit(true);
    });
  });
  if (!exited && child.exitCode === null) child.kill('SIGKILL');
}

jest.setTimeout(120_000);

describe('Authentication through the API Gateway (e2e)', () => {
  let identityProcess: ChildProcess;
  let gatewayApp: INestApplication<App>;
  let gatewayConfig: GatewayConfig;
  let initialized = false;
  const originalEnvironment = { ...process.env };
  const phone = `+1202555${String(process.pid).padStart(4, '0').slice(-4)}`;
  const pin = '739182';
  const correlations: string[] = [];

  function stage(name: string): void {
    process.stderr.write(`[auth-e2e] ${name}\n`);
  }

  function track(response: SupertestResponse): SupertestResponse {
    const correlation = response.headers['x-correlation-id'];
    if (typeof correlation === 'string') correlations.push(correlation);
    return response;
  }

  beforeAll(async () => {
    stage('starting Identity');
    const repositoryRoot = resolve(process.cwd(), '..', '..');
    loadEnvironment({ path: resolve(repositoryRoot, '.env'), quiet: true });
    loadEnvironment({
      path: resolve(repositoryRoot, '.env.example'),
      quiet: true,
    });
    process.env.NODE_ENV = 'test';
    process.env.DEMO_AUTH_ENABLED = 'true';
    process.env.IDENTITY_INTERNAL_TOKEN = 'test-only-gateway-identity-token';
    process.env.IDENTITY_REDIS_PREFIX = `aegis:identity:test:gateway:${process.pid}:`;
    process.env.IDENTITY_PORT = String(await availablePort());
    process.env.IDENTITY_SERVICE_URL = `http://127.0.0.1:${process.env.IDENTITY_PORT}`;
    const identityEntry = resolve(
      process.cwd(),
      '..',
      '..',
      'services',
      'identity',
      'dist',
      'main.js',
    );
    identityProcess = spawn(process.execPath, [identityEntry], {
      cwd: resolve(process.cwd(), '..', '..', 'services', 'identity'),
      env: process.env,
      stdio: 'ignore',
      windowsHide: true,
    });
    await waitForIdentity(process.env.IDENTITY_SERVICE_URL, identityProcess);
    stage('Identity live');

    const gatewayModule = await Test.createTestingModule({
      imports: [GatewayAppModule],
    }).compile();
    gatewayApp = gatewayModule.createNestApplication({ bodyParser: false });
    configureGateway(gatewayApp);
    await gatewayApp.init();
    gatewayConfig = gatewayApp.get(GATEWAY_CONFIG);
    initialized = true;
    stage('Gateway initialized');
  });

  it('completes onboarding, cookie session, logout, and PIN plus OTP fallback', async () => {
    track(
      await request(gatewayApp.getHttpServer())
        .post('/api/v1/auth/onboarding/request-otp')
        .send({
          phone: '202-555-0100',
          preferredLanguage: 'EN',
          consentAccepted: true,
        })
        .expect(400),
    );
    track(
      await request(gatewayApp.getHttpServer())
        .post('/api/v1/auth/onboarding/request-otp')
        .send({ phone, preferredLanguage: 'EN' })
        .expect(400),
    );

    const otpResponse = track(
      await request(gatewayApp.getHttpServer())
        .post('/api/v1/auth/onboarding/request-otp')
        .send({ phone, preferredLanguage: 'EN', consentAccepted: true })
        .expect(202),
    );
    stage('onboarding OTP requested');
    const onboardingOtp = bodyAs<OtpAcceptedResponse>(otpResponse);
    expect(onboardingOtp.demoOtp).toMatch(/^\d{6}$/u);

    track(
      await request(gatewayApp.getHttpServer())
        .post('/api/v1/auth/onboarding/verify-otp')
        .send({
          phone,
          challengeId: onboardingOtp.challengeId,
          otp: '999999',
        })
        .expect(401),
    );
    const enrollment = track(
      await request(gatewayApp.getHttpServer())
        .post('/api/v1/auth/onboarding/verify-otp')
        .send({
          phone,
          challengeId: onboardingOtp.challengeId,
          otp: onboardingOtp.demoOtp,
        })
        .expect(201),
    );
    const enrollmentBody = bodyAs<EnrollmentBody>(enrollment);
    stage('onboarding OTP verified');
    track(
      await request(gatewayApp.getHttpServer())
        .post('/api/v1/auth/onboarding/verify-otp')
        .send({
          phone,
          challengeId: onboardingOtp.challengeId,
          otp: onboardingOtp.demoOtp,
        })
        .expect(401),
    );

    track(
      await request(gatewayApp.getHttpServer())
        .post('/api/v1/auth/onboarding/create-pin')
        .send({
          enrollmentToken: enrollmentBody.enrollmentToken,
          pin: '123456',
          pinConfirmation: '123456',
        })
        .expect(400),
    );
    const authenticated = track(
      await request(gatewayApp.getHttpServer())
        .post('/api/v1/auth/onboarding/create-pin')
        .send({
          enrollmentToken: enrollmentBody.enrollmentToken,
          pin,
          pinConfirmation: pin,
        })
        .expect(201),
    );
    stage('PIN created');
    const onboardingCookies = cookiesFrom(authenticated);
    const onboardingCookieHeader = cookieHeader(onboardingCookies);
    const onboardingCsrf = cookieValue(onboardingCookies, 'aegis_csrf');
    expect(onboardingCookies[0]).toContain('HttpOnly');
    expect(
      onboardingCookies.every((cookie) => cookie.includes('SameSite=Lax')),
    ).toBe(true);
    const authenticatedBody: unknown = authenticated.body;
    expect(JSON.stringify(authenticatedBody)).not.toContain(onboardingCsrf);
    expect(authenticatedBody).not.toHaveProperty('sessionId');

    track(
      await request(gatewayApp.getHttpServer())
        .get('/api/v1/auth/session')
        .set('cookie', onboardingCookieHeader)
        .expect(200),
    );
    track(
      await request(gatewayApp.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('cookie', onboardingCookieHeader)
        .send({})
        .expect(403),
    );
    track(
      await request(gatewayApp.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('cookie', onboardingCookieHeader)
        .set('x-csrf-token', 'invalid-csrf')
        .send({})
        .expect(403),
    );
    const logout = track(
      await request(gatewayApp.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('cookie', onboardingCookieHeader)
        .set('x-csrf-token', onboardingCsrf)
        .send({})
        .expect(200),
    );
    stage('session revoked');
    expect(
      cookiesFrom(logout).every((cookie) => cookie.includes('Max-Age=0')),
    ).toBe(true);
    track(
      await request(gatewayApp.getHttpServer())
        .get('/api/v1/auth/session')
        .set('cookie', onboardingCookieHeader)
        .expect(401),
    );
    await request(gatewayApp.getHttpServer())
      .post('/api/v1/auth/logout')
      .send({})
      .expect(200, { revoked: true });

    track(
      await request(gatewayApp.getHttpServer())
        .post('/api/v1/auth/fallback/request-otp')
        .send({ phone, pin: '739183' })
        .expect(401),
    );
    const fallbackOtp = track(
      await request(gatewayApp.getHttpServer())
        .post('/api/v1/auth/fallback/request-otp')
        .send({ phone, pin })
        .expect(202),
    );
    const fallbackOtpBody = bodyAs<OtpAcceptedResponse>(fallbackOtp);
    stage('fallback OTP requested');
    track(
      await request(gatewayApp.getHttpServer())
        .post('/api/v1/auth/fallback/login')
        .send({
          phone,
          pin,
          challengeId: fallbackOtpBody.challengeId,
          otp: '999999',
        })
        .expect(401),
    );
    const fallbackLogin = track(
      await request(gatewayApp.getHttpServer())
        .post('/api/v1/auth/fallback/login')
        .send({
          phone,
          pin,
          challengeId: fallbackOtpBody.challengeId,
          otp: fallbackOtpBody.demoOtp,
        })
        .expect(201),
    );
    stage('fallback login complete');
    const fallbackCookies = cookiesFrom(fallbackLogin);
    const fallbackCookieHeader = cookieHeader(fallbackCookies);
    const fallbackCsrf = cookieValue(fallbackCookies, 'aegis_csrf');
    await request(gatewayApp.getHttpServer())
      .get('/api/v1/auth/session')
      .set('cookie', fallbackCookieHeader)
      .expect(200);

    const registrationOptions = track(
      await request(gatewayApp.getHttpServer())
        .post('/api/v1/auth/passkeys/registration/options')
        .set('cookie', fallbackCookieHeader)
        .set('x-csrf-token', fallbackCsrf)
        .send({})
        .expect(201),
    );
    expect(bodyAs<ChallengeBody>(registrationOptions).challenge).toEqual(
      expect.any(String),
    );
    const authenticationOptions = track(
      await request(gatewayApp.getHttpServer())
        .post('/api/v1/auth/passkeys/authentication/options')
        .send({})
        .expect(201),
    );
    expect(bodyAs<ChallengeBody>(authenticationOptions).challenge).toEqual(
      expect.any(String),
    );
    stage('passkey options complete');

    const originalUrl = gatewayConfig.identityServiceUrl;
    gatewayConfig.identityServiceUrl = 'http://127.0.0.1:1';
    track(
      await request(gatewayApp.getHttpServer())
        .post('/api/v1/auth/passkeys/authentication/options')
        .send({})
        .expect(503),
    );
    gatewayConfig.identityServiceUrl = originalUrl;
    stage('dependency failure mapped');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      track(
        await request(gatewayApp.getHttpServer())
          .post('/api/v1/auth/fallback/request-otp')
          .send({ phone, pin: '739183' })
          .expect(401),
      );
    }
    await request(gatewayApp.getHttpServer())
      .post('/api/v1/auth/fallback/request-otp')
      .send({ phone, pin })
      .expect(401);
    stage('temporary lockout confirmed');
  });

  afterAll(async () => {
    if (initialized) {
      stage('cleanup started');
      const pool = new Pool({
        connectionString: process.env.IDENTITY_DATABASE_URL,
      });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'DELETE FROM app.auth_events WHERE correlation_id = ANY($1::uuid[])',
          [correlations],
        );
        await client.query('DELETE FROM app.users WHERE phone_e164 = $1', [
          phone,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
        await pool.end();
      }
      stage('database cleanup complete');

      const redis = createClient({ url: process.env.REDIS_URL });
      await redis.connect();
      for await (const keys of redis.scanIterator({
        MATCH: `${process.env.IDENTITY_REDIS_PREFIX}*`,
        COUNT: 100,
      })) {
        if (keys.length > 0) await redis.unlink(keys);
      }
      await redis.quit();
      stage('Redis cleanup complete');
      await gatewayApp.close();
      await stopChild(identityProcess);
      stage('services stopped');
    } else if (identityProcess && identityProcess.exitCode === null) {
      await stopChild(identityProcess);
    }
    process.env = originalEnvironment;
  });
});
