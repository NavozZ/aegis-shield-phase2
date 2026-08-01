import { SabclError } from '@aegis/sabcl';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/gateway.config';
import type { RequestContext } from '../common/http/request-context';
import { SabclTransportService } from '../sabcl/sabcl-transport.service';

export const PAYMENTS_ENDPOINTS = {
  policy: '/internal/transfer-policy',
  preview: '/internal/transfer-intents',
  authorize: (token: string) =>
    `/internal/transfer-intents/${encodeURIComponent(token)}/authorize`,
  confirm: '/internal/transfers',
  transfers: (customerId: string, query: string) =>
    `/internal/customers/${encodeURIComponent(customerId)}/transfers${query}`,
  transfer: (customerId: string, id: string) =>
    `/internal/customers/${encodeURIComponent(customerId)}/transfers/${encodeURIComponent(id)}`,
  ready: '/health/ready',
} as const;

@Injectable()
export class PaymentsClient {
  constructor(
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
    private readonly sabcl: SabclTransportService,
  ) {}

  async request<T extends z.ZodType>(
    path: string,
    method: 'GET' | 'POST',
    schema: T,
    request: RequestContext,
    options: { body?: unknown; customerId?: string } = {},
  ): Promise<z.output<T>> {
    if (this.sabcl.enabled) {
      return this.requestThroughSabcl(path, method, schema, request, options);
    }
    return this.requestDirect(path, method, schema, request, options);
  }

  /**
   * Encrypted path for transfer orchestration.
   *
   * This is the traffic the layer exists for: amounts, recipient references and
   * PIN authorisation all travel inside the ciphertext, so the router forwarding
   * a confirmation cannot distinguish it from a policy read.
   */
  private async requestThroughSabcl<T extends z.ZodType>(
    path: string,
    method: 'GET' | 'POST',
    schema: T,
    request: RequestContext,
    options: { body?: unknown; customerId?: string },
  ): Promise<z.output<T>> {
    try {
      const response = await this.sabcl.call({
        capability: 'payments.transfer',
        operation: `payments.transfer.${method.toLowerCase()}`,
        method,
        path,
        body: options.body,
        customerId: options.customerId,
        correlationId: request.correlationId,
      });
      if (response.status >= 400) {
        throw new HttpException(
          response.body ?? { error: { code: 'PAYMENTS_UNAVAILABLE' } },
          response.status,
        );
      }
      const parsed = schema.safeParse(response.body);
      if (!parsed.success) {
        throw new HttpException(
          { error: { code: 'PAYMENTS_UNAVAILABLE' } },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof SabclError && !this.sabcl.strict) {
        // Compatible mode only. Strict mode never falls back.
        return this.requestDirect(path, method, schema, request, options);
      }
      throw new HttpException(
        { error: { code: 'PAYMENTS_UNAVAILABLE' } },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /** The pre-SABCL direct internal call. Unchanged. */
  private async requestDirect<T extends z.ZodType>(
    path: string,
    method: 'GET' | 'POST',
    schema: T,
    request: RequestContext,
    options: { body?: unknown; customerId?: string } = {},
  ): Promise<z.output<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.paymentsTimeoutMs,
    );
    try {
      const headers = new Headers({
        accept: 'application/json',
        'content-type': 'application/json',
        'x-aegis-internal-token': this.config.paymentsInternalToken,
        'x-correlation-id': request.correlationId,
      });
      if (options.customerId)
        headers.set('x-aegis-customer-id', options.customerId);
      const response = await fetch(
        new URL(path, this.config.paymentsServiceUrl),
        {
          method,
          headers,
          body:
            method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined,
          signal: controller.signal,
        },
      );
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok)
        throw new HttpException(
          body ?? { error: { code: 'PAYMENTS_UNAVAILABLE' } },
          response.status,
        );
      const parsed = schema.safeParse(body);
      if (!parsed.success)
        throw new HttpException(
          { error: { code: 'PAYMENTS_UNAVAILABLE' } },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      return parsed.data;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        { error: { code: 'PAYMENTS_UNAVAILABLE' } },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  async ready(): Promise<boolean> {
    try {
      return (
        await fetch(
          new URL(PAYMENTS_ENDPOINTS.ready, this.config.paymentsServiceUrl),
          {
            headers: {
              'x-aegis-internal-token': this.config.paymentsInternalToken,
            },
          },
        )
      ).ok;
    } catch {
      return false;
    }
  }
}
