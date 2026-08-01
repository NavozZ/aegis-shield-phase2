import {
  controlCheckResponseSchema,
  riskAssessmentSchema,
  securityEventV1Schema,
  type ControlScope,
  type RiskEvaluationRequest,
  type SecurityEventV1,
} from '@aegis/contracts';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../common/http/request-context';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/gateway.config';
@Injectable()
export class RiskClient {
  constructor(@Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig) {}
  private async request(
    path: string,
    method: 'GET' | 'POST',
    request: RequestContext,
    body?: unknown,
    operator?: { session: string; csrf?: string },
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.riskTimeoutMs,
    );
    try {
      const headers = new Headers({
        accept: 'application/json',
        'content-type': 'application/json',
        'x-aegis-internal-token': this.config.riskInternalToken,
        'x-correlation-id': request.correlationId,
      });
      if (operator) {
        headers.set('x-aegis-operator-session', operator.session);
        if (operator.csrf) headers.set('x-csrf-token', operator.csrf);
      }
      const response = await fetch(new URL(path, this.config.riskServiceUrl), {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
        signal: controller.signal,
      });
      const result: unknown = await response.json().catch(() => undefined);
      if (!response.ok)
        throw new HttpException(
          response.status === 401 || response.status === 403
            ? {
                error: {
                  code: 'OPERATOR_UNAUTHORIZED',
                  message: 'Security operator authentication is required.',
                },
              }
            : {
                error: {
                  code: 'SECURITY_CONTROL_ACTIVE',
                  message: 'The operation cannot be completed.',
                },
              },
          response.status,
        );
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        {
          error: {
            code: 'RISK_UNAVAILABLE',
            message: 'The operation cannot be completed securely.',
          },
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  async check(
    request: RequestContext,
    operation: string,
    scopes: Array<{ type: ControlScope; id: string }>,
  ) {
    return controlCheckResponseSchema.parse(
      await this.request('/internal/v1/controls/check', 'POST', request, {
        operation,
        scopes,
        correlationId: request.correlationId,
      }),
    );
  }
  async evaluate(
    request: RequestContext,
    input: Omit<
      RiskEvaluationRequest,
      'evaluationId' | 'occurredAt' | 'correlationId'
    >,
  ) {
    return riskAssessmentSchema.parse(
      await this.request('/internal/v1/assessments/evaluate', 'POST', request, {
        ...input,
        evaluationId: randomUUID(),
        occurredAt: new Date().toISOString(),
        correlationId: request.correlationId,
      }),
    );
  }
  async emit(
    request: RequestContext,
    event: Omit<
      SecurityEventV1,
      | 'schemaVersion'
      | 'eventId'
      | 'source'
      | 'sourceEventId'
      | 'occurredAt'
      | 'correlationId'
    >,
  ) {
    const body = securityEventV1Schema.parse({
      ...event,
      schemaVersion: '1.0',
      eventId: randomUUID(),
      source: 'GATEWAY',
      sourceEventId: `gateway:${randomUUID()}`,
      occurredAt: new Date().toISOString(),
      correlationId: request.correlationId,
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
          'x-aegis-source-token': this.config.riskGatewaySourceToken,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      /* Telemetry is fail-open; enforcement calls above are fail-closed. */
    } finally {
      clearTimeout(timeout);
    }
  }
  operator(
    path: string,
    method: 'GET' | 'POST',
    request: RequestContext,
    operator: { session: string; csrf?: string },
    body?: unknown,
  ) {
    return this.request(
      `/internal/v1/operators${path}`,
      method,
      request,
      body,
      operator,
    );
  }
}
