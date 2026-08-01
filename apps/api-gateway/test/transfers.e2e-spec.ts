import type {
  CustomerAccountDetail,
  OtpAcceptedResponse,
  SessionResponse,
  TransferDetail,
  TransferListResponse,
  TransferPreviewResponse,
} from '@aegis/contracts';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { config as loadEnvironment } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { createClient } from 'redis';
import request, { type Response as SupertestResponse } from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import {
  startService,
  stopService,
  waitForService,
  type ManagedService,
} from './service-process';

function body<T>(response: SupertestResponse): T {
  return response.body as T;
}
function cookies(response: SupertestResponse): string[] {
  const value = response.headers['set-cookie'];
  if (!Array.isArray(value)) throw new Error('Expected browser cookies.');
  return value;
}
function cookieHeader(values: string[]): string {
  return values.map((value) => value.split(';', 1)[0]).join('; ');
}
function cookieValue(values: string[], name: string): string {
  const value = values.find((candidate) => candidate.startsWith(`${name}=`));
  if (!value) throw new Error(`Expected ${name} cookie.`);
  return decodeURIComponent(value.split(';', 1)[0].slice(name.length + 1));
}
async function port(): Promise<number> {
  const server = createServer();
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', ok);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Could not allocate a port.');
  await new Promise<void>((ok, fail) =>
    server.close((error) => (error ? fail(error) : ok())),
  );
  return address.port;
}
/*
 * Service startup uses the shared helper in ./service-process, which keeps a
 * bounded window of each child's output and reports a sanitised tail when the
 * process dies. Before that, a Nest dependency-resolution failure and a bad
 * connection string both surfaced in CI as the single sentence
 * "Payments exited during startup."
 */

jest.setTimeout(240_000);
describe('Customer transfers through Gateway, Identity, Payments and Ledger (e2e)', () => {
  const original = { ...process.env };
  const suffix = `${process.pid}${Date.now()}`.slice(-7);
  const senderPhone = `+1202${suffix}`;
  const recipientPhone = `+1302${suffix}`;
  const pin = '739182';
  const customerIds: string[] = [];
  let identity: ManagedService | undefined;
  let ledger: ManagedService | undefined;
  let payments: ManagedService | undefined;
  let gateway: INestApplication<App>;
  let root: string;

  function server() {
    return gateway.getHttpServer();
  }
  function start(name: string, entry: string, cwd: string): ManagedService {
    return startService({
      name,
      entry: resolve(root, entry),
      cwd: resolve(root, cwd),
      environment: process.env,
    });
  }
  async function startLedger() {
    ledger = start('Ledger', 'services/ledger/dist/main.js', 'services/ledger');
    await waitForService(ledger, `${process.env.LEDGER_SERVICE_URL}/health`);
  }
  async function onboard(phone: string) {
    const accepted = body<OtpAcceptedResponse>(
      await request(server())
        .post('/api/v1/auth/onboarding/request-otp')
        .send({ phone, preferredLanguage: 'EN', consentAccepted: true })
        .expect(202),
    );
    const enrollment = body<{ enrollmentToken: string }>(
      await request(server())
        .post('/api/v1/auth/onboarding/verify-otp')
        .send({
          phone,
          challengeId: accepted.challengeId,
          otp: accepted.demoOtp,
        })
        .expect(201),
    );
    const authenticated = await request(server())
      .post('/api/v1/auth/onboarding/create-pin')
      .send({
        enrollmentToken: enrollment.enrollmentToken,
        pin,
        pinConfirmation: pin,
      })
      .expect(201);
    const values = cookies(authenticated);
    const browserCookie = cookieHeader(values);
    const session = body<SessionResponse>(
      await request(server())
        .get('/api/v1/auth/session')
        .set('cookie', browserCookie)
        .expect(200),
    );
    customerIds.push(session.user.id);
    return {
      cookie: browserCookie,
      csrf: cookieValue(values, 'aegis_csrf'),
      customerId: session.user.id,
    };
  }
  async function account(browser: { cookie: string; csrf: string }) {
    return body<CustomerAccountDetail>(
      await request(server())
        .post('/api/v1/accounts/default')
        .set('cookie', browser.cookie)
        .set('x-csrf-token', browser.csrf)
        .set('idempotency-key', `acct-${randomUUID()}`)
        .send({})
        .expect(201),
    );
  }
  async function fund(accountId: string, amountMinor: string) {
    const pool = new Pool({
      connectionString: process.env.LEDGER_DATABASE_URL,
    });
    const { rows } = await pool.query<{ wallet: string; settlement: string }>(
      `SELECT customer.ledger_account_id AS wallet, system.id AS settlement
       FROM app.customer_accounts customer CROSS JOIN app.ledger_accounts system
       WHERE customer.id=$1::uuid AND system.system_account_type='PLATFORM_SETTLEMENT_ASSET'`,
      [accountId],
    );
    await pool.end();
    const row = rows[0];
    if (!row) throw new Error('Funding accounts missing.');
    const response = await fetch(
      `${process.env.LEDGER_SERVICE_URL}/internal/journal-entries`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-aegis-internal-token': process.env.LEDGER_INTERNAL_TOKEN!,
          'x-correlation-id': randomUUID(),
        },
        body: JSON.stringify({
          entryType: 'SETTLEMENT_FUNDING',
          currency: 'LKR',
          idempotencyKey: `transfer-e2e-fund-${randomUUID()}`,
          reference: `JRN-TRANSFER-E2E-${randomUUID()}`.slice(0, 64),
          postings: [
            {
              ledgerAccountId: row.settlement,
              direction: 'DEBIT',
              amountMinor,
            },
            { ledgerAccountId: row.wallet, direction: 'CREDIT', amountMinor },
          ],
        }),
      },
    );
    if (!response.ok) throw new Error(`Funding failed (${response.status}).`);
  }
  async function preview(
    browser: { cookie: string; csrf: string },
    sourceAccountId: string,
    recipientReference: string,
    amount = '100.00',
  ) {
    return body<TransferPreviewResponse>(
      await request(server())
        .post('/api/v1/transfers/preview')
        .set('cookie', browser.cookie)
        .set('x-csrf-token', browser.csrf)
        .send({ sourceAccountId, recipientReference, amount })
        .expect(201),
    );
  }
  async function confirm(
    browser: { cookie: string; csrf: string },
    intentToken: string,
    key: string,
    expected = 200,
  ) {
    return body<TransferDetail>(
      await request(server())
        .post('/api/v1/transfers/confirm')
        .set('cookie', browser.cookie)
        .set('x-csrf-token', browser.csrf)
        .set('idempotency-key', key)
        .send({ intentToken, pin })
        .expect(expected),
    );
  }

  beforeAll(async () => {
    root = resolve(process.cwd(), '..', '..');
    loadEnvironment({ path: resolve(root, '.env'), quiet: true });
    loadEnvironment({ path: resolve(root, '.env.example'), quiet: true });
    process.env.NODE_ENV = 'test';
    process.env.DEMO_AUTH_ENABLED = 'true';
    process.env.IDENTITY_INTERNAL_TOKEN = 'test-transfer-identity-token';
    process.env.LEDGER_INTERNAL_TOKEN = 'test-transfer-ledger-token';
    process.env.PAYMENTS_INTERNAL_TOKEN = 'test-transfer-payments-token';
    process.env.IDENTITY_REDIS_PREFIX = `aegis:identity:test:transfers:${process.pid}:`;
    process.env.IDENTITY_PORT = String(await port());
    process.env.IDENTITY_SERVICE_URL = `http://127.0.0.1:${process.env.IDENTITY_PORT}`;
    process.env.LEDGER_SERVICE_PORT = String(await port());
    process.env.LEDGER_SERVICE_URL = `http://127.0.0.1:${process.env.LEDGER_SERVICE_PORT}`;
    process.env.PAYMENTS_SERVICE_PORT = String(await port());
    process.env.PAYMENTS_SERVICE_URL = `http://127.0.0.1:${process.env.PAYMENTS_SERVICE_PORT}`;
    process.env.PAYMENTS_RECOVERY_STALE_SECONDS = '1';
    identity = start(
      'Identity',
      'services/identity/dist/main.js',
      'services/identity',
    );
    await waitForService(
      identity,
      `${process.env.IDENTITY_SERVICE_URL}/health/live`,
    );
    await startLedger();
    payments = start(
      'Payments',
      'services/payments/dist/main.js',
      'services/payments',
    );
    await waitForService(
      payments,
      `${process.env.PAYMENTS_SERVICE_URL}/health/live`,
    );
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    gateway = module.createNestApplication({ bodyParser: false });
    configureApplication(gateway);
    await gateway.init();
  });

  it('executes, replays, recovers and privately exposes a real transfer', async () => {
    await request(server())
      .post('/api/v1/transfers/preview')
      .send({})
      .expect(401);
    const sender = await onboard(senderPhone);
    const recipient = await onboard(recipientPhone);
    const senderAccount = await account(sender);
    const recipientAccount = await account(recipient);
    await fund(senderAccount.id, '100000');

    await request(server())
      .post('/api/v1/transfers/preview')
      .set('cookie', sender.cookie)
      .send({
        sourceAccountId: senderAccount.id,
        recipientReference: recipientAccount.receivingReference,
        amount: '100.00',
      })
      .expect(403);
    await request(server())
      .post('/api/v1/transfers/preview')
      .set('cookie', sender.cookie)
      .set('x-csrf-token', sender.csrf)
      .send({
        sourceAccountId: senderAccount.id,
        recipientReference: recipientAccount.receivingReference,
        amount: '100.00',
        customerId: recipient.customerId,
      })
      .expect(400);
    await request(server())
      .post('/api/v1/transfers/preview')
      .set('cookie', sender.cookie)
      .set('x-csrf-token', sender.csrf)
      .send({
        sourceAccountId: senderAccount.id,
        recipientReference: senderAccount.receivingReference,
        amount: '1.00',
      })
      .expect(409);
    const insufficientPreview = await preview(
      sender,
      senderAccount.id,
      recipientAccount.receivingReference,
      '10000.00',
    );
    const insufficient = await confirm(
      sender,
      insufficientPreview.intentToken,
      `transfer-${randomUUID()}`,
    );
    expect(insufficient).toMatchObject({
      status: 'FAILED',
      failureCode: 'INSUFFICIENT_FUNDS',
    });

    const reviewed = await preview(
      sender,
      senderAccount.id,
      recipientAccount.receivingReference,
    );
    expect(reviewed.recipientMaskedReference).toBe(
      recipientAccount.maskedReference,
    );
    await request(server())
      .post('/api/v1/transfers/confirm')
      .set('cookie', sender.cookie)
      .set('x-csrf-token', sender.csrf)
      .set('idempotency-key', `transfer-${randomUUID()}`)
      .send({ intentToken: reviewed.intentToken, pin: '111111' })
      .expect(401);
    const key = `transfer-${randomUUID()}`;
    const completed = await confirm(sender, reviewed.intentToken, key);
    expect(completed).toMatchObject({
      status: 'COMPLETED',
      direction: 'SENT',
      amount: { minorUnits: '10000' },
    });
    for (const forbidden of [
      'senderCustomerId',
      'recipientCustomerId',
      'ledgerJournalId',
      'idempotencyKeyHash',
      'requestHash',
    ])
      expect(completed).not.toHaveProperty(forbidden);
    const replay = await confirm(sender, reviewed.intentToken, key);
    expect(replay.id).toBe(completed.id);

    const senderBalance = body<{ balance: { minorUnits: string } }>(
      await request(server())
        .get(`/api/v1/accounts/${senderAccount.id}/balance`)
        .set('cookie', sender.cookie)
        .expect(200),
    );
    const recipientBalance = body<{ balance: { minorUnits: string } }>(
      await request(server())
        .get(`/api/v1/accounts/${recipientAccount.id}/balance`)
        .set('cookie', recipient.cookie)
        .expect(200),
    );
    expect(senderBalance.balance.minorUnits).toBe('90000');
    expect(recipientBalance.balance.minorUnits).toBe('10000');
    const sent = body<TransferListResponse>(
      await request(server())
        .get('/api/v1/transfers?direction=SENT')
        .set('cookie', sender.cookie)
        .expect('cache-control', /private, no-store/u)
        .expect(200),
    );
    const received = body<TransferListResponse>(
      await request(server())
        .get('/api/v1/transfers?direction=RECEIVED')
        .set('cookie', recipient.cookie)
        .expect(200),
    );
    expect(sent.transfers.map((item) => item.id)).toContain(completed.id);
    expect(received.transfers.map((item) => item.id)).toContain(completed.id);
    await request(server())
      .get(`/api/v1/transfers/${completed.id}`)
      .set('cookie', recipient.cookie)
      .expect(200);
    const stranger = await onboard(`+1402${suffix}`);
    await request(server())
      .get(`/api/v1/transfers/${completed.id}`)
      .set('cookie', stranger.cookie)
      .expect(404);

    const pendingPreview = await preview(
      sender,
      senderAccount.id,
      recipientAccount.receivingReference,
      '1.00',
    );
    // Simulates a Ledger outage mid-transfer, so the confirmation is left
    // PROCESSING and recovery has something real to resolve.
    await stopService(ledger);
    const pending = await confirm(
      sender,
      pendingPreview.intentToken,
      `transfer-${randomUUID()}`,
      202,
    );
    expect(pending.status).toBe('PROCESSING');
    await startLedger();
    const pool = new Pool({
      connectionString: process.env.PAYMENTS_DATABASE_URL,
    });
    await pool.query(
      "UPDATE app.transfers SET updated_at=now()-interval '2 minutes', next_attempt_at=now()-interval '1 minute' WHERE id=$1::uuid",
      [pending.id],
    );
    await pool.end();
    const recovery = await fetch(
      `${process.env.PAYMENTS_SERVICE_URL}/internal/recovery/run`,
      {
        method: 'POST',
        headers: {
          'x-aegis-internal-token': process.env.PAYMENTS_INTERNAL_TOKEN!,
        },
      },
    );
    expect(recovery.ok).toBe(true);
    const recovered = body<TransferDetail>(
      await request(server())
        .get(`/api/v1/transfers/${pending.id}`)
        .set('cookie', sender.cookie)
        .expect(200),
    );
    expect(recovered.status).toBe('COMPLETED');
  });

  afterAll(async () => {
    if (gateway) await gateway.close();
    await Promise.all(
      [identity, payments, ledger].map((service) => stopService(service)),
    );
    if (process.env.IDENTITY_REDIS_PREFIX && process.env.REDIS_URL) {
      const redis = createClient({ url: process.env.REDIS_URL });
      await redis.connect();
      for await (const keys of redis.scanIterator({
        MATCH: `${process.env.IDENTITY_REDIS_PREFIX}*`,
        COUNT: 100,
      }))
        if (keys.length) await redis.unlink(keys);
      await redis.quit();
    }
    const identityPool = new Pool({
      connectionString: process.env.IDENTITY_DATABASE_URL,
    });
    await identityPool.query(
      'DELETE FROM app.auth_events WHERE user_id = ANY($1::uuid[])',
      [customerIds],
    );
    await identityPool.query(
      'DELETE FROM app.users WHERE phone_e164 = ANY($1::text[])',
      [[senderPhone, recipientPhone, `+1402${suffix}`]],
    );
    await identityPool.end();
    process.env = original;
  });
});
