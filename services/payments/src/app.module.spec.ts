import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { AgentService } from './agent/agent.service';
import { QrService } from './qr/qr.service';
import { TransfersService } from './transfers/transfers.service';
import { UssdService } from './ussd/ussd.service';
import { LedgerClient } from './transfers/ledger.client';
import { PaymentsSabclService } from './sabcl/sabcl.service';
import {
  PAYMENTS_CONFIG,
  type PaymentsConfig,
} from './common/config/payments.config';

/*
 * The regression test for the failure this branch fixes.
 *
 * The transfer end-to-end suite failed in CI with "Payments exited during
 * startup". The cause was a dependency-resolution error: UssdService injects
 * LedgerClient, but UssdModule neither declared it nor imported a module that
 * exported it. QrModule and AgentModule both declared it; UssdModule was the
 * one that did not.
 *
 * Nothing caught it, because every Payments unit suite constructs its service
 * directly with test doubles and never assembles the real application. Nest
 * resolves the whole provider graph at startup, so a missing provider anywhere
 * takes down the entire service — not just the feature that needs it.
 *
 * `compile()` builds that graph without running lifecycle hooks, so this test
 * needs no database, no Redis and no ports, and runs in the ordinary unit
 * suite where it will be seen immediately.
 *
 * dotenv is stubbed out because both createPaymentsConfig and the SABCL
 * recipient runtime read the repository-root `.env` at call time. Without the
 * stub the graph is assembled from whatever a developer happens to have in that
 * file — a stale SABCL_MODE there fails the suite for reasons that have nothing
 * to do with the code under test.
 */
jest.mock('dotenv', () => ({ config: jest.fn() }));

/** Deterministic, obviously fake configuration. Never real key material. */
const TEST_ENVIRONMENT: Record<string, string> = {
  NODE_ENV: 'test',
  PAYMENTS_SERVICE_PORT: '4104',
  PAYMENTS_DATABASE_URL:
    'postgresql://aegis_payments:test-only-password@127.0.0.1:5432/aegis_payments?schema=app',
  PAYMENTS_INTERNAL_TOKEN: 'test-only-payments-internal-token',
  LEDGER_SERVICE_URL: 'http://127.0.0.1:4102',
  LEDGER_INTERNAL_TOKEN: 'test-only-ledger-internal-token',
  PAYMENTS_QR_SIGNING_KEY: 'test-only-qr-signing-key',
  PAYMENTS_QR_DYNAMIC_TTL_SECONDS: '300',
  PAYMENTS_QR_STATIC_TTL_HOURS: '8760',
  USSD_PROVIDER_SECRET: 'test-only-ussd-provider-secret',
  REDIS_URL: 'redis://127.0.0.1:6379/0',
  PAYMENTS_REDIS_PREFIX: 'aegis:payments:test:app-module:',
  // SABCL off is the default posture: the recipient is registered but not
  // wired in. What matters for this suite is that the SABCL module can sit
  // in the same graph as the inclusive channels without either breaking the
  // other. The SABCL package has its own suites for strict and compatible mode.
  SABCL_MODE: 'off',
};

describe('Payments AppModule', () => {
  const original = { ...process.env };

  beforeEach(() => {
    // Start from a clean slate so an inherited value cannot make a missing
    // variable look present, or a stale one break an unrelated assertion.
    for (const name of Object.keys(process.env)) {
      if (
        name.startsWith('PAYMENTS_') ||
        name.startsWith('USSD_') ||
        name.startsWith('SABCL_')
      ) {
        delete process.env[name];
      }
    }
    Object.assign(process.env, TEST_ENVIRONMENT);
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it('resolves every provider in the real application graph', async () => {
    // This is the assertion that fails if any module is missing a provider.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef.get(TransfersService, { strict: false })).toBeDefined();
    expect(moduleRef.get(QrService, { strict: false })).toBeDefined();
    expect(moduleRef.get(AgentService, { strict: false })).toBeDefined();
    expect(moduleRef.get(UssdService, { strict: false })).toBeDefined();
    expect(
      moduleRef.get(PaymentsSabclService, { strict: false }),
    ).toBeDefined();

    await moduleRef.close();
  });

  it('registers the inclusive channels and the SABCL recipient together', async () => {
    // The integration assertion: both phases occupy the same provider graph.
    // Either one failing to construct takes down the whole Payments service,
    // which is how the earlier UssdModule defect broke transfers.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const sabcl = moduleRef.get(PaymentsSabclService, { strict: false });
    expect(sabcl).toBeInstanceOf(PaymentsSabclService);
    // SABCL_MODE=off, so the recipient is present but deliberately not wired in.
    expect(sabcl.enabled).toBe(false);
    expect(sabcl.mode).toBe('off');

    for (const service of [QrService, AgentService, UssdService]) {
      expect(moduleRef.get(service, { strict: false })).toBeDefined();
    }

    await moduleRef.close();
  });

  it('gives the USSD channel a LedgerClient, the provider that was missing', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Named explicitly rather than folded into the test above, so a future
    // regression points straight at the cause instead of at "something in the
    // graph broke".
    expect(moduleRef.get(UssdService, { strict: false })).toBeInstanceOf(
      UssdService,
    );
    expect(moduleRef.get(LedgerClient, { strict: false })).toBeInstanceOf(
      LedgerClient,
    );

    await moduleRef.close();
  });

  it('keeps QR configuration available to the QR channel', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const config = moduleRef.get<PaymentsConfig>(PAYMENTS_CONFIG, {
      strict: false,
    });
    expect(config.qrSigningKey).toBe(TEST_ENVIRONMENT.PAYMENTS_QR_SIGNING_KEY);
    expect(config.qrDynamicTtlSeconds).toBe(300);
    expect(config.qrStaticTtlHours).toBe(8760);

    await moduleRef.close();
  });

  it('keeps Redis state namespaced away from other services', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const config = moduleRef.get<PaymentsConfig>(PAYMENTS_CONFIG, {
      strict: false,
    });
    // A bare prefix would let Payments channel state collide with the identity
    // service's session state in a shared Redis.
    expect(config.redisKeyPrefix).toBe(TEST_ENVIRONMENT.PAYMENTS_REDIS_PREFIX);
    expect(config.redisKeyPrefix.endsWith(':')).toBe(true);

    await moduleRef.close();
  });

  it('starts the transfer graph even though the inclusive channels are registered', async () => {
    // The transfer end-to-end suite exercises transfers only, but it starts the
    // whole Payments service. A channel module that cannot be constructed
    // therefore breaks transfers, which is exactly how this failure presented.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef.get(TransfersService, { strict: false })).toBeInstanceOf(
      TransfersService,
    );

    await moduleRef.close();
  });
});
