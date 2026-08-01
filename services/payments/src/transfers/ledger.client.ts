import {
  internalLedgerTransferResultSchema,
  internalTransferPreviewResultSchema,
  type InternalLedgerTransferCommand,
  type InternalTransferPreview,
} from '@aegis/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  PAYMENTS_CONFIG,
  type PaymentsConfig,
} from '../common/config/payments.config';
import { PaymentsError } from '../common/errors/payments.error';
export class LedgerCallError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super('Ledger request failed.');
  }
}
@Injectable()
export class LedgerClient {
  constructor(
    @Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig,
  ) {}
  private async call(path: string, body: unknown, correlationId: string) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.httpTimeoutMs,
    );
    try {
      const response = await fetch(
        new URL(path, this.config.ledgerServiceUrl),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-aegis-internal-token': this.config.ledgerInternalToken,
            'x-correlation-id': correlationId,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok)
        throw new LedgerCallError(
          response.status,
          typeof payload === 'object' &&
            payload !== null &&
            'error' in payload &&
            typeof (payload as { error?: { code?: unknown } }).error?.code ===
              'string'
            ? (payload as { error: { code: string } }).error.code
            : undefined,
        );
      return payload;
    } catch (error) {
      if (error instanceof LedgerCallError) throw error;
      throw new PaymentsError(
        'LEDGER_UNAVAILABLE',
        'The transfer is processing.',
        HttpStatus.ACCEPTED,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  async preview(input: InternalTransferPreview, correlationId: string) {
    return internalTransferPreviewResultSchema.parse(
      await this.call(
        '/internal/customer-transfers/preview',
        input,
        correlationId,
      ),
    );
  }
  async transfer(input: InternalLedgerTransferCommand, correlationId: string) {
    return internalLedgerTransferResultSchema.parse(
      await this.call('/internal/customer-transfers', input, correlationId),
    );
  }
  async ready() {
    try {
      const response = await fetch(
        new URL('/health/ready', this.config.ledgerServiceUrl),
        {
          headers: {
            'x-aegis-internal-token': this.config.ledgerInternalToken,
          },
        },
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}
