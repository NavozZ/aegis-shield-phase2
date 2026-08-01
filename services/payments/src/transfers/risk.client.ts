import {
  controlCheckResponseSchema,
  riskAssessmentSchema,
  securityEventV1Schema,
  type RiskEvaluationRequest,
  type SecurityEventV1,
} from '@aegis/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  PAYMENTS_CONFIG,
  type PaymentsConfig,
} from '../common/config/payments.config';
import { PaymentsError } from '../common/errors/payments.error';
@Injectable()
export class PaymentsRiskClient {
  constructor(
    @Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig,
  ) {}
  private async internal(path: string, body: unknown) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.riskTimeoutMs,
    );
    try {
      const response = await fetch(new URL(path, this.config.riskServiceUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-aegis-internal-token': this.config.riskInternalToken,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const result: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error('Risk rejected the request.');
      return result;
    } catch {
      throw new PaymentsError(
        'RISK_UNAVAILABLE',
        'The transfer could not be completed securely.',
        503,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  async enforce(
    input: Omit<RiskEvaluationRequest, 'evaluationId' | 'occurredAt'>,
  ) {
    const scopes = [
      { type: 'CUSTOMER' as const, id: input.subjectId },
      ...(input.accountId
        ? [{ type: 'ACCOUNT' as const, id: input.accountId }]
        : []),
      ...(input.recipientId
        ? [{ type: 'RECIPIENT' as const, id: input.recipientId }]
        : []),
    ];
    const controls = controlCheckResponseSchema.parse(
      await this.internal('/internal/v1/controls/check', {
        operation: input.operation,
        scopes,
        correlationId: input.correlationId,
      }),
    );
    if (!controls.allowed)
      throw new PaymentsError(
        'SECURITY_CONTROL_ACTIVE',
        'The transfer could not be completed.',
        403,
      );
    const assessment = riskAssessmentSchema.parse(
      await this.internal('/internal/v1/assessments/evaluate', {
        ...input,
        evaluationId: randomUUID(),
        occurredAt: new Date().toISOString(),
      }),
    );
    if (!['ALLOW', 'ALLOW_WITH_MONITORING'].includes(assessment.decision))
      throw new PaymentsError(
        'SECURITY_CONTROL_ACTIVE',
        'The transfer could not be completed.',
        403,
      );
    return assessment;
  }
  async emit(
    input: Omit<
      SecurityEventV1,
      'schemaVersion' | 'eventId' | 'source' | 'sourceEventId' | 'occurredAt'
    >,
  ) {
    const body = securityEventV1Schema.parse({
      ...input,
      schemaVersion: '1.0',
      eventId: randomUUID(),
      source: 'PAYMENTS',
      sourceEventId: `payments:${randomUUID()}`,
      occurredAt: new Date().toISOString(),
    });
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.riskTimeoutMs,
    );
    try {
      await fetch(new URL('/internal/v1/events', this.config.riskServiceUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-aegis-source-token': this.config.riskPaymentsSourceToken,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      /* Lifecycle telemetry is fail-open; final posting enforcement is fail-closed. */
    } finally {
      clearTimeout(timeout);
    }
  }
}
