import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/gateway.config';
import type { RequestContext } from '../common/http/request-context';

export const LEDGER_ENDPOINTS = {
  provisionDefaultAccount: '/internal/customer-accounts/default',
  customerAccounts: (customerId: string) =>
    `/internal/customers/${encodeURIComponent(customerId)}/accounts`,
  customerAccount: (accountId: string) =>
    `/internal/customer-accounts/${encodeURIComponent(accountId)}`,
  customerAccountBalance: (accountId: string) =>
    `/internal/customer-accounts/${encodeURIComponent(accountId)}/balance`,
  ready: '/health/ready',
} as const;

export class LedgerHttpError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: unknown,
  ) {
    super(`Ledger returned HTTP ${status}.`);
  }
}

/**
 * Server-side client for the Ledger service.
 *
 * The internal token never leaves the Gateway process and is never echoed to a
 * browser. Every response is re-validated against the shared contract before it
 * is returned, so a malformed or unexpected upstream payload cannot reach a
 * customer.
 */
@Injectable()
export class LedgerClient {
  constructor(@Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig) {}

  async request<T extends z.ZodType>(
    endpoint: string,
    method: 'GET' | 'POST',
    schema: T,
    request: RequestContext,
    options: { body?: unknown; customerId?: string } = {},
  ): Promise<z.output<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.ledgerTimeoutMs,
    );
    try {
      const headers = new Headers({
        accept: 'application/json',
        'content-type': 'application/json',
        'x-aegis-internal-token': this.config.ledgerInternalToken,
        'x-correlation-id': request.correlationId,
      });
      // The customer identity always comes from the validated session, never
      // from a browser-supplied field.
      if (options.customerId) {
        headers.set('x-aegis-customer-id', options.customerId);
      }

      const response = await fetch(
        new URL(endpoint, this.config.ledgerServiceUrl),
        {
          method,
          headers,
          body:
            method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined,
          signal: controller.signal,
        },
      );
      const responseBody: unknown = await response
        .json()
        .catch(() => undefined);
      if (!response.ok) {
        throw new LedgerHttpError(response.status, responseBody);
      }

      const parsed = schema.safeParse(responseBody);
      if (!parsed.success) {
        // An upstream response that does not satisfy the contract is treated as
        // an outage rather than passed through unvalidated.
        throw new HttpException(
          { error: { code: 'LEDGER_UNAVAILABLE' } },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof LedgerHttpError) {
        throw new HttpException(error.responseBody ?? {}, error.status);
      }
      throw new HttpException(
        { error: { code: 'LEDGER_UNAVAILABLE' } },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async ready(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.ledgerTimeoutMs,
    );
    try {
      const response = await fetch(
        new URL(LEDGER_ENDPOINTS.ready, this.config.ledgerServiceUrl),
        {
          headers: {
            'x-aegis-internal-token': this.config.ledgerInternalToken,
          },
          signal: controller.signal,
        },
      );
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}
