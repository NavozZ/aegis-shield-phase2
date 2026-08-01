import type {
  CustomerAccountDetail,
  CustomerAccountList,
  OtpAcceptedResponse,
  SessionResponse,
  TransactionHistoryResponse,
  CustomerTransactionDetail,
} from '@aegis/contracts';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type ChildProcess, spawn } from 'node:child_process';
import { config as loadEnvironment } from 'dotenv';
import { randomUUID } from 'node:crypto';
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
  return response.body as T;
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

async function waitForService(
  url: string,
  child: ChildProcess,
  name: string,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null)
      throw new Error(`${name} exited during test startup.`);
    try {
      if ((await fetch(`${url}/health/live`)).ok) return;
    } catch {
      // The service may still be binding its loopback listener.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`${name} did not become live within twenty seconds.`);
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

jest.setTimeout(180_000);

describe('Accounts through the API Gateway (e2e)', () => {
  let identityProcess: ChildProcess;
  let ledgerProcess: ChildProcess;
  let gatewayApp: INestApplication<App>;
  let gatewayConfig: GatewayConfig;
  let initialized = false;
  const originalEnvironment = { ...process.env };
  const suffix = String(process.pid).padStart(4, '0').slice(-4);
  const ownerPhone = `+1202556${suffix}`;
  const otherPhone = `+1202557${suffix}`;
  const pin = '739182';
  const customerIds: string[] = [];

  function server() {
    return gatewayApp.getHttpServer();
  }

  async function postSyntheticJournal(
    accountId: string,
    direction: 'INCOMING' | 'OUTGOING',
    amountMinor: string,
    suffix: string,
  ): Promise<void> {
    const pool = new Pool({
      connectionString: process.env.LEDGER_DATABASE_URL,
    });
    const { rows } = await pool.query<{
      wallet_id: string;
      settlement_id: string;
    }>(
      `SELECT customer.ledger_account_id AS wallet_id, system.id AS settlement_id
       FROM app.customer_accounts AS customer
       CROSS JOIN app.ledger_accounts AS system
       WHERE customer.id = $1::uuid
         AND system.system_account_type = 'PLATFORM_SETTLEMENT_ASSET'`,
      [accountId],
    );
    await pool.end();
    const row = rows[0];
    if (!row) throw new Error('Synthetic test ledger accounts were not found.');
    const incoming = direction === 'INCOMING';
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
          entryType: incoming ? 'SETTLEMENT_FUNDING' : 'ACCOUNT_ADJUSTMENT',
          currency: 'LKR',
          idempotencyKey: `transactions-e2e-${suffix}-${randomUUID()}`,
          reference: `JRN-TXN-E2E-${suffix}-${randomUUID()}`.slice(0, 64),
          postings: incoming
            ? [
                {
                  ledgerAccountId: row.settlement_id,
                  direction: 'DEBIT',
                  amountMinor,
                },
                {
                  ledgerAccountId: row.wallet_id,
                  direction: 'CREDIT',
                  amountMinor,
                },
              ]
            : [
                {
                  ledgerAccountId: row.wallet_id,
                  direction: 'DEBIT',
                  amountMinor,
                },
                {
                  ledgerAccountId: row.settlement_id,
                  direction: 'CREDIT',
                  amountMinor,
                },
              ],
        }),
      },
    );
    if (!response.ok)
      throw new Error(`Synthetic journal setup failed (${response.status}).`);
  }

  /** Onboards a synthetic customer and returns its browser credentials. */
  async function onboard(phone: string): Promise<{
    cookies: string;
    csrf: string;
    customerId: string;
  }> {
    const otp = bodyAs<OtpAcceptedResponse>(
      await request(server())
        .post('/api/v1/auth/onboarding/request-otp')
        .send({ phone, preferredLanguage: 'EN', consentAccepted: true })
        .expect(202),
    );
    const enrollment = bodyAs<{ enrollmentToken: string }>(
      await request(server())
        .post('/api/v1/auth/onboarding/verify-otp')
        .send({ phone, challengeId: otp.challengeId, otp: otp.demoOtp })
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

    const cookies = cookiesFrom(authenticated);
    const session = bodyAs<SessionResponse>(
      await request(server())
        .get('/api/v1/auth/session')
        .set('cookie', cookieHeader(cookies))
        .expect(200),
    );
    customerIds.push(session.user.id);
    return {
      cookies: cookieHeader(cookies),
      csrf: cookieValue(cookies, 'aegis_csrf'),
      customerId: session.user.id,
    };
  }

  beforeAll(async () => {
    const repositoryRoot = resolve(process.cwd(), '..', '..');
    loadEnvironment({ path: resolve(repositoryRoot, '.env'), quiet: true });
    loadEnvironment({
      path: resolve(repositoryRoot, '.env.example'),
      quiet: true,
    });
    process.env.NODE_ENV = 'test';
    process.env.DEMO_AUTH_ENABLED = 'true';
    process.env.IDENTITY_INTERNAL_TOKEN = 'test-only-accounts-identity-token';
    process.env.LEDGER_INTERNAL_TOKEN = 'test-only-accounts-ledger-token';
    process.env.IDENTITY_REDIS_PREFIX = `aegis:identity:test:accounts:${process.pid}:`;
    process.env.IDENTITY_PORT = String(await availablePort());
    process.env.IDENTITY_SERVICE_URL = `http://127.0.0.1:${process.env.IDENTITY_PORT}`;
    process.env.LEDGER_SERVICE_PORT = String(await availablePort());
    process.env.LEDGER_SERVICE_URL = `http://127.0.0.1:${process.env.LEDGER_SERVICE_PORT}`;

    identityProcess = spawn(
      process.execPath,
      [resolve(repositoryRoot, 'services', 'identity', 'dist', 'main.js')],
      {
        cwd: resolve(repositoryRoot, 'services', 'identity'),
        env: process.env,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    await waitForService(
      process.env.IDENTITY_SERVICE_URL,
      identityProcess,
      'Identity',
    );

    ledgerProcess = spawn(
      process.execPath,
      [resolve(repositoryRoot, 'services', 'ledger', 'dist', 'main.js')],
      {
        cwd: resolve(repositoryRoot, 'services', 'ledger'),
        env: process.env,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    await waitForService(
      process.env.LEDGER_SERVICE_URL,
      ledgerProcess,
      'Ledger',
    );

    const gatewayModule = await Test.createTestingModule({
      imports: [GatewayAppModule],
    }).compile();
    gatewayApp = gatewayModule.createNestApplication({ bodyParser: false });
    configureGateway(gatewayApp);
    await gatewayApp.init();
    gatewayConfig = gatewayApp.get(GATEWAY_CONFIG);
    initialized = true;
  });

  it('protects account routes and provisions exactly one Tier-0 wallet', async () => {
    // Unauthenticated access is refused before any ledger call is made.
    await request(server()).get('/api/v1/accounts').expect(401);
    await request(server())
      .post('/api/v1/accounts/default')
      .set('idempotency-key', `acct-${randomUUID()}`)
      .send({})
      .expect(401);

    const owner = await onboard(ownerPhone);

    await request(server())
      .get('/api/v1/accounts')
      .set('cookie', owner.cookies)
      .expect(200, { accounts: [] });

    // CSRF is mandatory for the state-changing route.
    await request(server())
      .post('/api/v1/accounts/default')
      .set('cookie', owner.cookies)
      .set('idempotency-key', `acct-${randomUUID()}`)
      .send({})
      .expect(403);
    await request(server())
      .post('/api/v1/accounts/default')
      .set('cookie', owner.cookies)
      .set('x-csrf-token', 'invalid-csrf-token')
      .set('idempotency-key', `acct-${randomUUID()}`)
      .send({})
      .expect(403);

    // A valid idempotency key is mandatory.
    const missingKey = await request(server())
      .post('/api/v1/accounts/default')
      .set('cookie', owner.cookies)
      .set('x-csrf-token', owner.csrf)
      .send({})
      .expect(400);
    expect(bodyAs<{ error: { code: string } }>(missingKey).error.code).toBe(
      'IDEMPOTENCY_KEY_REQUIRED',
    );
    await request(server())
      .post('/api/v1/accounts/default')
      .set('cookie', owner.cookies)
      .set('x-csrf-token', owner.csrf)
      .set('idempotency-key', 'short')
      .send({})
      .expect(400);

    const idempotencyKey = `acct-default-${randomUUID()}`;
    const created = bodyAs<CustomerAccountDetail>(
      await request(server())
        .post('/api/v1/accounts/default')
        .set('cookie', owner.cookies)
        .set('x-csrf-token', owner.csrf)
        .set('idempotency-key', idempotencyKey)
        .send({})
        .expect(201),
    );
    expect(created.balance).toEqual({ currency: 'LKR', minorUnits: '0' });
    expect(created.status).toBe('ACTIVE');
    expect(created.maskedReference).toMatch(/^AEGIS-\*{4}-\*{4}-[A-Z0-9]{4}$/u);
    // Internal identifiers must never reach the browser.
    expect(JSON.stringify(created)).not.toContain(owner.customerId);
    expect(created).not.toHaveProperty('ledgerAccountId');
    expect(created).not.toHaveProperty('publicReference');

    // Repeating the same key returns the original account.
    const replayed = bodyAs<CustomerAccountDetail>(
      await request(server())
        .post('/api/v1/accounts/default')
        .set('cookie', owner.cookies)
        .set('x-csrf-token', owner.csrf)
        .set('idempotency-key', idempotencyKey)
        .send({})
        .expect(201),
    );
    expect(replayed.id).toBe(created.id);

    // A fresh key must still not create a second default account.
    const repeated = bodyAs<CustomerAccountDetail>(
      await request(server())
        .post('/api/v1/accounts/default')
        .set('cookie', owner.cookies)
        .set('x-csrf-token', owner.csrf)
        .set('idempotency-key', `acct-default-${randomUUID()}`)
        .send({})
        .expect(201),
    );
    expect(repeated.id).toBe(created.id);

    const listed = bodyAs<CustomerAccountList>(
      await request(server())
        .get('/api/v1/accounts')
        .set('cookie', owner.cookies)
        .expect(200),
    );
    expect(listed.accounts).toHaveLength(1);
    expect(listed.accounts[0]?.id).toBe(created.id);

    const detail = bodyAs<CustomerAccountDetail>(
      await request(server())
        .get(`/api/v1/accounts/${created.id}`)
        .set('cookie', owner.cookies)
        .expect(200),
    );
    expect(detail.id).toBe(created.id);

    const balance = bodyAs<{ balance: { minorUnits: string } }>(
      await request(server())
        .get(`/api/v1/accounts/${created.id}/balance`)
        .set('cookie', owner.cookies)
        .expect(200),
    );
    expect(balance.balance.minorUnits).toBe('0');
    expect(typeof balance.balance.minorUnits).toBe('string');

    await request(server())
      .get(`/api/v1/accounts/${created.id}/transactions`)
      .set('cookie', owner.cookies)
      .expect(200, { transactions: [], nextCursor: null });
    await request(server())
      .get(`/api/v1/accounts/${created.id}/transactions/${randomUUID()}`)
      .set('cookie', owner.cookies)
      .expect(404);

    await postSyntheticJournal(created.id, 'INCOMING', '1000', 'incoming');
    await postSyntheticJournal(created.id, 'OUTGOING', '250', 'outgoing');
    for (let index = 0; index < 3; index += 1)
      await postSyntheticJournal(created.id, 'INCOMING', '1', `page-${index}`);

    const history = bodyAs<TransactionHistoryResponse>(
      await request(server())
        .get(`/api/v1/accounts/${created.id}/transactions?pageSize=2`)
        .set('cookie', owner.cookies)
        .expect('cache-control', /private, no-store/u)
        .expect(200),
    );
    expect(history.transactions).toHaveLength(2);
    expect(history.nextCursor).toBeTruthy();
    const next = bodyAs<TransactionHistoryResponse>(
      await request(server())
        .get(
          `/api/v1/accounts/${created.id}/transactions?pageSize=2&cursor=${encodeURIComponent(history.nextCursor!)}`,
        )
        .set('cookie', owner.cookies)
        .expect(200),
    );
    expect(
      new Set(
        [...history.transactions, ...next.transactions].map((item) => item.id),
      ).size,
    ).toBe(4);
    const outgoing = bodyAs<TransactionHistoryResponse>(
      await request(server())
        .get(
          `/api/v1/accounts/${created.id}/transactions?direction=OUTGOING&category=ADJUSTMENT`,
        )
        .set('cookie', owner.cookies)
        .expect(200),
    );
    expect(outgoing.transactions).toHaveLength(1);
    const outgoingTransaction = outgoing.transactions[0];
    if (!outgoingTransaction)
      throw new Error('Expected an outgoing transaction.');
    expect(outgoingTransaction).toMatchObject({
      direction: 'OUTGOING',
      category: 'ADJUSTMENT',
      balanceAfter: { minorUnits: '750' },
    });
    const transactionDetail = bodyAs<CustomerTransactionDetail>(
      await request(server())
        .get(
          `/api/v1/accounts/${created.id}/transactions/${outgoingTransaction.id}`,
        )
        .set('cookie', owner.cookies)
        .expect('cache-control', /private, no-store/u)
        .expect(200),
    );
    expect(transactionDetail.maskedAccountReference).toBe(
      created.maskedReference,
    );
    for (const forbidden of [
      'ledgerAccountId',
      'customerId',
      'metadata',
      'createdBy',
      'correlationId',
    ])
      expect(transactionDetail).not.toHaveProperty(forbidden);
    await request(server())
      .get(`/api/v1/accounts/${created.id}/transactions?cursor=malformed`)
      .set('cookie', owner.cookies)
      .expect(400);
    await request(server())
      .post(`/api/v1/accounts/${created.id}/transactions`)
      .set('cookie', owner.cookies)
      .send({})
      .expect(404);

    // Ownership: a second customer sees only their own account and cannot read
    // the first customer's account even with a valid identifier.
    const other = await onboard(otherPhone);
    await request(server())
      .get('/api/v1/accounts')
      .set('cookie', other.cookies)
      .expect(200, { accounts: [] });
    await request(server())
      .get(`/api/v1/accounts/${created.id}`)
      .set('cookie', other.cookies)
      .expect(404);
    await request(server())
      .get(`/api/v1/accounts/${created.id}/balance`)
      .set('cookie', other.cookies)
      .expect(404);
    await request(server())
      .get(`/api/v1/accounts/${created.id}/transactions`)
      .set('cookie', other.cookies)
      .expect(404);
    await request(server())
      .get(
        `/api/v1/accounts/${created.id}/transactions/${outgoingTransaction.id}`,
      )
      .set('cookie', other.cookies)
      .expect(404);
    await request(server())
      .get(`/api/v1/accounts/${randomUUID()}`)
      .set('cookie', owner.cookies)
      .expect(404);
    await request(server())
      .get('/api/v1/accounts/not-a-uuid')
      .set('cookie', owner.cookies)
      .expect(404);

    // There is no browser-facing journal route.
    await request(server())
      .post('/api/v1/journal-entries')
      .set('cookie', owner.cookies)
      .set('x-csrf-token', owner.csrf)
      .send({})
      .expect(404);

    // A Ledger outage is normalised, never surfaced as an internal failure.
    const originalLedgerUrl = gatewayConfig.ledgerServiceUrl;
    gatewayConfig.ledgerServiceUrl = 'http://127.0.0.1:1';
    const unavailable = await request(server())
      .get('/api/v1/accounts')
      .set('cookie', owner.cookies)
      .expect(503);
    expect(bodyAs<{ error: { code: string } }>(unavailable).error.code).toBe(
      'LEDGER_UNAVAILABLE',
    );
    gatewayConfig.ledgerServiceUrl = originalLedgerUrl;

    await request(server())
      .get('/api/v1/accounts')
      .set('cookie', owner.cookies)
      .expect(200);
  });

  afterAll(async () => {
    if (initialized) {
      // Destructive cleanup is limited to the synthetic records this suite
      // created, and only ever runs under NODE_ENV=test.
      if (process.env.NODE_ENV !== 'test') {
        throw new Error('Scoped cleanup requires NODE_ENV=test.');
      }

      const ledgerPool = new Pool({
        connectionString: process.env.LEDGER_DATABASE_URL,
      });
      const ledgerClient = await ledgerPool.connect();
      try {
        await ledgerClient.query('BEGIN');
        const { rows } = await ledgerClient.query<{
          ledger_account_id: string;
        }>(
          'SELECT ledger_account_id FROM app.customer_accounts WHERE customer_id = ANY($1::uuid[])',
          [customerIds],
        );
        await ledgerClient.query(
          'DELETE FROM app.customer_accounts WHERE customer_id = ANY($1::uuid[])',
          [customerIds],
        );
        if (rows.length > 0) {
          // Ledger accounts that never received a posting can be removed; their
          // balance projections cascade. Accounts with postings are immutable
          // and are intentionally left in place.
          await ledgerClient.query(
            `DELETE FROM app.ledger_accounts
             WHERE id = ANY($1::uuid[])
               AND NOT EXISTS (
                 SELECT 1 FROM app.journal_postings
                 WHERE journal_postings.ledger_account_id = ledger_accounts.id
               )`,
            [rows.map((row) => row.ledger_account_id)],
          );
        }
        await ledgerClient.query('COMMIT');
      } catch (error) {
        await ledgerClient.query('ROLLBACK');
        throw error;
      } finally {
        ledgerClient.release();
        await ledgerPool.end();
      }

      const identityPool = new Pool({
        connectionString: process.env.IDENTITY_DATABASE_URL,
      });
      const identityClient = await identityPool.connect();
      try {
        await identityClient.query('BEGIN');
        await identityClient.query(
          'DELETE FROM app.auth_events WHERE user_id = ANY($1::uuid[])',
          [customerIds],
        );
        await identityClient.query(
          'DELETE FROM app.users WHERE phone_e164 = ANY($1::text[])',
          [[ownerPhone, otherPhone]],
        );
        await identityClient.query('COMMIT');
      } catch (error) {
        await identityClient.query('ROLLBACK');
        throw error;
      } finally {
        identityClient.release();
        await identityPool.end();
      }

      const redis = createClient({ url: process.env.REDIS_URL });
      await redis.connect();
      for await (const keys of redis.scanIterator({
        MATCH: `${process.env.IDENTITY_REDIS_PREFIX}*`,
        COUNT: 100,
      })) {
        if (keys.length > 0) await redis.unlink(keys);
      }
      await redis.quit();

      await gatewayApp.close();
    }
    await Promise.all(
      [identityProcess, ledgerProcess]
        .filter((child) => child && child.exitCode === null)
        .map((child) => stopChild(child)),
    );
    process.env = originalEnvironment;
  });
});
