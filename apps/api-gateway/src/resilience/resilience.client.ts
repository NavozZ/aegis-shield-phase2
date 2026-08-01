import {
  drillHistoryResponseSchema,
  recoveryDrillSchema,
  recoveryReadinessSchema,
  drillAuditEventSchema,
} from '@aegis/contracts';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { RequestContext } from '../common/http/request-context';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/gateway.config';

/*
 * The gateway's only route to the Resilience service.
 *
 * Two properties this client is responsible for:
 *
 * 1. Every response is re-validated against the published contract before it
 *    leaves the gateway. The Resilience service already refuses to emit secrets,
 *    but the browser-facing boundary does not take that on trust — a schema here
 *    means a future field added upstream cannot silently reach an operator's
 *    browser.
 * 2. Upstream failures collapse to a small set of safe codes. A connection
 *    error, a 500 and a schema mismatch all read the same from outside, so the
 *    console cannot be used to probe the internal topology.
 */
@Injectable()
export class ResilienceClient {
  constructor(@Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig) {}

  private async request<T>(
    path: string,
    method: 'GET' | 'POST',
    request: RequestContext,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.resilienceTimeoutMs,
    );
    try {
      const response = await fetch(
        new URL(path, this.config.resilienceServiceUrl),
        {
          method,
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            // The gateway's own credential, not the resilience internal token.
            'x-aegis-source-token': this.config.resilienceGatewaySourceToken,
            'x-correlation-id': request.correlationId,
          },
          body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
          signal: controller.signal,
        },
      );
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        // A conflict is the one upstream status worth distinguishing: it means
        // the operator acted on stale console state, and repeating the request
        // will not help.
        throw new HttpException(
          {
            error:
              response.status === 409
                ? {
                    code: 'RESILIENCE_STATE_CONFLICT',
                    message: 'The recovery record has already moved on.',
                  }
                : response.status === 404
                  ? {
                      code: 'RESILIENCE_RECORD_NOT_FOUND',
                      message: 'The recovery record was not found.',
                    }
                  : {
                      code: 'RESILIENCE_UNAVAILABLE',
                      message: 'Recovery information is not available.',
                    },
          },
          response.status === 409 || response.status === 404
            ? response.status
            : HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      return schema.parse(payload);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Timeouts, connection refusals and contract violations are all reported
      // as one unavailable state. No upstream detail crosses this line.
      throw new HttpException(
        {
          error: {
            code: 'RESILIENCE_UNAVAILABLE',
            message: 'Recovery information is not available.',
          },
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  readiness(request: RequestContext) {
    return this.request(
      '/internal/v1/readiness',
      'GET',
      request,
      recoveryReadinessSchema,
    );
  }

  history(request: RequestContext, query: string) {
    return this.request(
      `/internal/v1/drills${query}`,
      'GET',
      request,
      drillHistoryResponseSchema,
    );
  }

  drill(request: RequestContext, drillId: string) {
    return this.request(
      `/internal/v1/drills/${encodeURIComponent(drillId)}`,
      'GET',
      request,
      recoveryDrillSchema,
    );
  }

  events(request: RequestContext, drillId: string) {
    return this.request(
      `/internal/v1/drills/${encodeURIComponent(drillId)}/events`,
      'GET',
      request,
      z.object({ events: z.array(drillAuditEventSchema).max(200) }).strict(),
    );
  }

  acknowledge(
    request: RequestContext,
    drillId: string,
    operatorId: string,
    reason: string,
  ) {
    return this.request(
      `/internal/v1/drills/${encodeURIComponent(drillId)}/acknowledge?operatorId=${encodeURIComponent(operatorId)}`,
      'POST',
      request,
      recoveryDrillSchema,
      { reason },
    );
  }

  recordPlanned(
    request: RequestContext,
    operatorId: string,
    input: { type: 'SCHEDULED' | 'MANUAL' | 'CI_AUTOMATED'; note?: string },
  ) {
    return this.request(
      `/internal/v1/drills?requestedBy=${encodeURIComponent(operatorId)}`,
      'POST',
      request,
      recoveryDrillSchema,
      input,
    );
  }
}
