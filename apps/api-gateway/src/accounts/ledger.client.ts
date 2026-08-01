import { SabclError, type SabclCapabilityId } from '@aegis/sabcl';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/gateway.config';
import type { RequestContext } from '../common/http/request-context';
import { SabclTransportService } from '../sabcl/sabcl-transport.service';

export const LEDGER_ENDPOINTS = {
  provisionDefaultAccount: '/internal/customer-accounts/default',
  customerAccounts: (customerId: string) =>
    `/internal/customers/${encodeURIComponent(customerId)}/accounts`,
  customerAccount: (accountId: string) =>
    `/internal/customer-accounts/${encodeURIComponent(accountId)}`,
  customerAccountBalance: (accountId: string) =>
    `/internal/customer-accounts/${encodeURIComponent(accountId)}/balance`,
  customerTransactions: (accountId: string, query: string) =>
    `/internal/customer-accounts/${encodeURIComponent(accountId)}/transactions${query}`,
  customerTransaction: (accountId: string, transactionId: string) =>
    `/internal/customer-accounts/${encodeURIComponent(accountId)}/transactions/${encodeURIComponent(transactionId)}`,
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
  constructor(
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
    private readonly sabcl: SabclTransportService,
  ) {}

  async request<T extends z.ZodType>(
    endpoint: string,
    method: 'GET' | 'POST',
    schema: T,
    request: RequestContext,
    options: { body?: unknown; customerId?: string } = {},
  ): Promise<z.output<T>> {
    // When SABCL is configured, every Gateway-to-Ledger call goes through the
    // blind router. In strict mode there is no other path: a router outage
    // surfaces as an outage, never as a plaintext retry.
    if (this.sabcl.enabled) {
      return this.requestThroughSabcl(
        endpoint,
        method,
        schema,
        request,
        options,
      );
    }
    return this.requestDirect(endpoint, method, schema, request, options);
  }

  /**
   * Encrypted path.
   *
   * The endpoint is chosen here, in the gateway, from a fixed set in
   * LEDGER_ENDPOINTS — never from anything a browser supplied — and then
   * encrypted before the router sees it.
   */
  private async requestThroughSabcl<T extends z.ZodType>(
    endpoint: string,
    method: 'GET' | 'POST',
    schema: T,
    request: RequestContext,
    options: { body?: unknown; customerId?: string },
  ): Promise<z.output<T>> {
    try {
      const capability = capabilityForEndpoint(endpoint);
      const response = await this.sabcl.call({
        capability,
        operation: `${capability}.${method.toLowerCase()}`,
        method,
        path: endpoint,
        body: options.body,
        customerId: options.customerId,
        correlationId: request.correlationId,
      });
      if (response.status >= 400) {
        throw new LedgerHttpError(response.status, response.body);
      }
      const parsed = schema.safeParse(response.body);
      if (!parsed.success) {
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
      if (error instanceof SabclError && !this.sabcl.strict) {
        // Compatible mode only: a documented, deliberately configured local
        // fallback. Strict mode never reaches this branch.
        return this.requestDirect(endpoint, method, schema, request, options);
      }
      throw new HttpException(
        { error: { code: 'LEDGER_UNAVAILABLE' } },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /** The pre-SABCL direct internal call. Unchanged. */
  private async requestDirect<T extends z.ZodType>(
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

/**
 * Selects the SABCL capability for a Ledger endpoint.
 *
 * Reads and postings are separate capabilities, so a route token that permits
 * listing accounts does not also permit moving money. The distinction is
 * enforced at the recipient by the path allowlist; this function is the sender
 * side of the same split.
 */
function capabilityForEndpoint(endpoint: string): SabclCapabilityId {
  return endpoint.startsWith('/internal/customer-transfers')
    ? 'ledger.postings'
    : 'ledger.accounts';
}
