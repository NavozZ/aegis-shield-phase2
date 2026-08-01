import {
  riskAssessmentSchema,
  type RiskAssessment,
  type RiskEvaluationRequest,
} from '@aegis/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { RISK_CONFIG, type RiskConfig } from '../common/config/risk.config';
import { sha256 } from '../common/security/security';
import { PrismaService } from '../database/prisma.service';
import { VelocityService } from '../events/velocity.service';
import { evaluateRisk, type RiskFacts } from './risk-engine';

@Injectable()
export class AssessmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly velocity: VelocityService,
    @Inject(RISK_CONFIG) private readonly config: RiskConfig,
  ) {}
  private async facts(input: RiskEvaluationRequest): Promise<RiskFacts> {
    const now = new Date();
    const [
      authFailures,
      requestVelocity,
      transferVelocity,
      cumulative,
      insufficient,
      idempotency,
      invalid,
      deviceSubjects,
      integrity,
      internalAuth,
      newRecipient,
      activeIncident,
      activeControls,
    ] = await Promise.all([
      this.velocity.read(input.subjectId, 'auth-failures:600s'),
      this.velocity.read(input.subjectId, 'requests:60s'),
      this.velocity.read(input.subjectId, 'transfers:600s'),
      this.velocity.read(input.subjectId, 'outgoing:86400s'),
      this.velocity.read(input.subjectId, 'insufficient:600s'),
      this.velocity.read(input.subjectId, 'idempotency:600s'),
      this.velocity.read(input.subjectId, 'invalid-sensitive:600s'),
      input.deviceId
        ? this.prisma.client.securityEvent.findMany({
            where: {
              deviceId: input.deviceId,
              subjectId: { not: null },
              occurredAt: { gte: new Date(now.getTime() - 86_400_000) },
            },
            select: { subjectId: true },
            distinct: ['subjectId'],
            take: 20,
          })
        : Promise.resolve([]),
      this.prisma.client.securityEvent.count({
        where: {
          subjectId: input.subjectId,
          eventType: {
            in: [
              'RECONCILIATION_ANOMALY',
              'UNBALANCED_JOURNAL',
              'INTEGRITY_FAILURE',
              'TAMPER_SIGNAL',
            ],
          },
          occurredAt: { gte: new Date(now.getTime() - 86_400_000) },
        },
      }),
      this.prisma.client.securityEvent.count({
        where: {
          subjectId: input.subjectId,
          eventType: { in: ['INTERNAL_AUTH_FAILURE', 'INVALID_SERVICE_TOKEN'] },
          occurredAt: { gte: new Date(now.getTime() - 3_600_000) },
        },
      }),
      input.recipientId
        ? this.prisma.client.securityEvent.count({
            where: {
              subjectId: input.subjectId,
              recipientId: input.recipientId,
              eventType: 'NEW_RECIPIENT',
              occurredAt: { gte: new Date(now.getTime() - 86_400_000) },
            },
          })
        : Promise.resolve(0),
      this.prisma.client.incident.count({
        where: {
          assessment: { subjectId: input.subjectId },
          status: { in: ['OPEN', 'INVESTIGATING', 'CONTAINED'] },
        },
      }),
      this.prisma.client.controlAction.findMany({
        where: {
          scopeType: 'CUSTOMER',
          scopeId: input.subjectId,
          status: 'ACTIVE',
          expiresAt: { gt: now },
        },
        select: { type: true },
        take: 20,
      }),
    ]);
    const blocking = activeControls.some((control) =>
      [
        'TEMPORARY_BLOCK',
        'QUARANTINE',
        'ACCOUNT_RESTRICT',
        'RECIPIENT_BLOCK',
      ].includes(control.type),
    );
    const relevantControl = activeControls.some(
      (control) => control.type !== 'REQUIRE_STEP_UP' || !input.stepUpVerified,
    );
    return {
      authFailures,
      requestVelocity,
      transferVelocity,
      cumulativeOutgoingMinor: BigInt(cumulative),
      newRecipient: newRecipient > 0,
      insufficientFunds: insufficient,
      idempotencyConflicts: idempotency,
      linkedSubjectsForDevice: deviceSubjects.length,
      rapidRegionChange: false,
      integrityAnomaly: integrity > 0,
      internalAuthFailures: internalAuth,
      csrfMalformedFailures: invalid,
      blockedScope: blocking,
      activeIncident: activeIncident > 0,
      activeControl: relevantControl,
    };
  }
  async evaluate(input: RiskEvaluationRequest): Promise<RiskAssessment> {
    const existing = await this.prisma.client.riskAssessment.findUnique({
      where: { evaluationId: input.evaluationId },
    });
    if (existing) return this.response(existing);
    const result = evaluateRisk(input, await this.facts(input), {
      authFailures: 5,
      requestVelocity: 60,
      transferVelocity: 5,
      cumulativeOutgoingMinor: this.config.cumulativeValueMinor,
      highValueMinor: this.config.highValueMinor,
      insufficientFunds: 3,
      idempotencyConflicts: 2,
      linkedSubjectsPerDevice: 3,
      csrfMalformed: 5,
    });
    const expiresAt = new Date(
      Date.now() + this.config.assessmentTtlSeconds * 1000,
    );
    const created = await this.prisma.client.$transaction(async (tx) => {
      const assessment = await tx.riskAssessment.create({
        data: {
          id: crypto.randomUUID(),
          evaluationId: input.evaluationId,
          subjectId: input.subjectId,
          operation: input.operation,
          score: result.score,
          band: result.band,
          decision: result.decision,
          triggeredRules: result.triggeredRules,
          reasonCodes: result.reasonCodes,
          controlRecommendation: result.controlRecommendation,
          inputFacts: {
            operation: input.operation,
            hasSession: Boolean(input.sessionId),
            hasDevice: Boolean(input.deviceId),
            hasAccount: Boolean(input.accountId),
            hasRecipient: Boolean(input.recipientId),
            amountMinor: input.amountMinor,
            stepUpVerified: input.stepUpVerified,
          },
          ruleSetVersion: 'risk-rules-2026-08-v1',
          publicExplanation: result.publicExplanation,
          expiresAt,
        },
      });
      let incidentId: string | undefined;
      if (['HIGH', 'CRITICAL'].includes(result.band)) {
        const incident = await tx.incident.create({
          data: {
            assessmentId: assessment.id,
            severity: result.band as 'HIGH' | 'CRITICAL',
            title: `Automated ${result.band.toLowerCase()} risk assessment`,
            events: {
              create: {
                eventType: 'CREATED',
                actorId: 'automated:risk-engine',
                note: result.reasonCodes.join(', ') || 'High aggregate risk',
              },
            },
          },
        });
        incidentId = incident.id;
      }
      if (result.controlRecommendation) {
        const duration =
          result.band === 'CRITICAL' ? 900 : result.band === 'HIGH' ? 600 : 300;
        await tx.controlAction.create({
          data: {
            idempotencyKeyHash: sha256(
              `assessment:${assessment.id}:${result.controlRecommendation}`,
            ),
            type: result.controlRecommendation,
            scopeType: 'CUSTOMER',
            scopeId: input.subjectId,
            operation: input.operation,
            reasonCode: result.reasonCodes[0] || 'RISK_SCORE_THRESHOLD',
            assessmentId: assessment.id,
            incidentId,
            createdBy: 'automated:risk-engine',
            expiresAt: new Date(Date.now() + duration * 1000),
            events: {
              create: {
                eventType: 'CREATED',
                actorId: 'automated:risk-engine',
                reason: `Deterministic assessment ${assessment.id}`,
              },
            },
          },
        });
      }
      return assessment;
    });
    return this.response(created);
  }
  private response(row: {
    id: string;
    score: number;
    band: string;
    decision: string;
    triggeredRules: string[];
    reasonCodes: string[];
    controlRecommendation: string | null;
    expiresAt: Date;
    ruleSetVersion: string;
    publicExplanation: string;
  }): RiskAssessment {
    return riskAssessmentSchema.parse({
      assessmentId: row.id,
      score: row.score,
      band: row.band,
      decision: row.decision,
      triggeredRules: row.triggeredRules,
      reasonCodes: row.reasonCodes,
      controlRecommendation: row.controlRecommendation,
      expiresAt: row.expiresAt.toISOString(),
      ruleSetVersion: row.ruleSetVersion,
      publicExplanation: row.publicExplanation,
    });
  }
}
