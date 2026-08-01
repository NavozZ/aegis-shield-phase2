import { randomUUID } from 'node:crypto';
import type { SecurityEventV1 } from '@aegis/contracts';
import { AssessmentService } from '../src/assessments/assessment.service';
import type { RiskConfig } from '../src/common/config/risk.config';
import { ControlService } from '../src/controls/control.service';
import type { IdentityControlClient } from '../src/controls/identity-control.client';
import { PrismaService } from '../src/database/prisma.service';
import { EventService } from '../src/events/event.service';
import { VelocityService } from '../src/events/velocity.service';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import { RedisService } from '../src/redis/redis.service';

const runId = randomUUID();
const subject = `subject:integration:${runId}`;
const config: RiskConfig = {
  host: '127.0.0.1',
  port: 4105,
  databaseUrl: process.env.RISK_DATABASE_URL!,
  redisUrl: process.env.REDIS_URL!,
  internalToken: 'integration-risk-token',
  sourceTokens: {
    GATEWAY: 'gateway-source',
    IDENTITY: 'identity-source',
    PAYMENTS: 'payments-source',
    LEDGER: 'ledger-source',
    INFRASTRUCTURE: 'infra-source',
    CHANNEL_ADAPTER: 'channel-source',
  },
  redisPrefix: `aegis:risk:test:${runId}:`,
  retentionDays: 30,
  assessmentTtlSeconds: 300,
  staleSourceSeconds: 900,
  operatorSessionTtlSeconds: 1800,
  highValueMinor: 10_000_000n,
  cumulativeValueMinor: 25_000_000n,
  identityServiceUrl: 'http://127.0.0.1:4101',
  identityInternalToken: 'identity-token',
  identityTimeoutMs: 1000,
};
function event(overrides: Partial<SecurityEventV1> = {}): SecurityEventV1 {
  return {
    schemaVersion: '1.0',
    eventId: randomUUID(),
    source: 'IDENTITY',
    sourceEventId: `identity:${randomUUID()}`,
    eventType: 'LOGIN_FAILURE',
    severity: 'MEDIUM',
    occurredAt: new Date().toISOString(),
    subjectId: subject,
    correlationId: randomUUID(),
    attributes: { outcome: 'FAILURE', operation: 'LOGIN' },
    ...overrides,
  };
}
describe('Risk PostgreSQL and Redis integration', () => {
  let prisma: PrismaService;
  let redis: RedisService;
  let events: EventService;
  let assessments: AssessmentService;
  let controls: ControlService;
  let reconciliation: ReconciliationService;
  beforeAll(async () => {
    if (!config.databaseUrl || !config.redisUrl)
      throw new Error('Risk integration URLs are required.');
    prisma = new PrismaService(config);
    redis = new RedisService(config);
    await Promise.all([prisma.onModuleInit(), redis.onModuleInit()]);
    const velocity = new VelocityService(redis);
    events = new EventService(prisma, velocity, config);
    assessments = new AssessmentService(prisma, velocity, config);
    const identity = {
      revokeSession: jest.fn().mockResolvedValue(undefined),
    } as unknown as IdentityControlClient;
    controls = new ControlService(prisma, identity);
    reconciliation = new ReconciliationService(prisma, controls);
  });
  afterAll(async () => {
    if (redis) {
      const keys = await redis.client.keys(`${config.redisPrefix}*`);
      if (keys.length) await redis.client.del(keys);
    }
    await Promise.all([prisma?.onModuleDestroy(), redis?.onModuleDestroy()]);
  });
  it('rejects source impersonation and idempotently accepts duplicate and out-of-order events', async () => {
    const original = event({
      occurredAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await expect(events.ingest(original, 'wrong-source')).rejects.toThrow();
    const [first, second] = await Promise.all([
      events.ingest(original, 'identity-source'),
      events.ingest(original, 'identity-source'),
    ]);
    expect([first.duplicate, second.duplicate].sort()).toEqual([false, true]);
    const older = event({
      occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    await events.ingest(older, 'identity-source');
    expect(
      await prisma.client.securityEvent.count({
        where: { subjectId: subject },
      }),
    ).toBe(2);
  });
  it('atomically tracks velocity and persists explainable idempotent assessments', async () => {
    for (let index = 0; index < 4; index += 1)
      await events.ingest(event(), 'identity-source');
    const evaluationId = randomUUID();
    const request = {
      evaluationId,
      operation: 'AUTHENTICATION' as const,
      subjectId: subject,
      stepUpVerified: false,
      occurredAt: new Date().toISOString(),
      correlationId: randomUUID(),
    };
    const first = await assessments.evaluate(request);
    const replay = await assessments.evaluate(request);
    expect(first).toEqual(replay);
    expect(first.triggeredRules).toContain('AUTH_FAILURE_BURST');
    expect(first.decision).toBe('REQUIRE_STEP_UP');
    expect(
      await prisma.client.controlAction.count({
        where: { assessmentId: first.assessmentId },
      }),
    ).toBe(1);
  });
  it('applies, releases and expires scoped controls with append-only history', async () => {
    const applied = await controls.apply(
      {
        idempotencyKey: `integration-control:${runId}`,
        type: 'TEMPORARY_BLOCK',
        scopeType: 'CUSTOMER',
        scopeId: subject,
        reasonCode: 'OPERATOR_CONFIRMED_THREAT',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      'operator:integration',
    );
    expect(
      (await controls.check([{ type: 'CUSTOMER', id: subject }])).allowed,
    ).toBe(false);
    await controls.release(
      applied.id,
      'Investigation confirmed safe activity.',
      'operator:integration',
    );
    expect(
      (await controls.check([{ type: 'CUSTOMER', id: subject }])).allowed,
    ).toBe(true);
    const expired = await prisma.client.controlAction.create({
      data: {
        idempotencyKeyHash: runId
          .replaceAll('-', '')
          .padEnd(64, 'a')
          .slice(0, 64),
        type: 'TRANSFER_HOLD',
        scopeType: 'CUSTOMER',
        scopeId: `${subject}:expired`,
        reasonCode: 'TEST_EXPIRY',
        createdBy: 'operator:integration',
        createdAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 60_000),
        events: {
          create: {
            eventType: 'CREATED',
            actorId: 'operator:integration',
            reason: 'Expiry integration fixture.',
          },
        },
      },
    });
    await controls.expire();
    expect(
      (
        await prisma.client.controlAction.findUniqueOrThrow({
          where: { id: expired.id },
        })
      ).status,
    ).toBe('EXPIRED');
    expect(
      await prisma.client.controlEvent.count({
        where: { controlId: expired.id },
      }),
    ).toBe(2);
  });
  it('enforces immutable original event facts', async () => {
    const retained = event();
    await events.ingest(retained, 'identity-source');
    await expect(
      prisma.client.securityEvent.update({
        where: { id: retained.eventId },
        data: { severity: 'LOW' },
      }),
    ).rejects.toThrow();
  });
  it('keeps subject assessments isolated and reconciles links', async () => {
    const other = `subject:integration:${randomUUID()}`;
    const result = await assessments.evaluate({
      evaluationId: randomUUID(),
      operation: 'SESSION_USE',
      subjectId: other,
      stepUpVerified: false,
      occurredAt: new Date().toISOString(),
      correlationId: randomUUID(),
    });
    expect(
      await prisma.client.riskAssessment.count({
        where: { subjectId: subject },
      }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.client.riskAssessment.count({ where: { subjectId: other } }),
    ).toBe(1);
    expect(result.score).toBe(0);
    const audit = await reconciliation.run();
    expect(audit.issues.orphanControls).toBe(0);
    expect(audit.issues.orphanControlEvents).toBe(0);
    expect(audit.issues.orphanIncidentEvents).toBe(0);
  });
});
