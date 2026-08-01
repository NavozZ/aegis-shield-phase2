import { securityEventV1Schema } from '@aegis/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  LEDGER_CONFIG,
  type LedgerConfig,
} from '../common/config/ledger.config';
@Injectable()
export class LedgerRiskEventClient {
  constructor(@Inject(LEDGER_CONFIG) private readonly config: LedgerConfig) {}
  async anomaly(correlationId: string, integrityCode: string) {
    const body = securityEventV1Schema.parse({
      schemaVersion: '1.0',
      eventId: randomUUID(),
      source: 'LEDGER',
      sourceEventId: `ledger:${randomUUID()}`,
      eventType: 'RECONCILIATION_ANOMALY',
      severity: 'CRITICAL',
      occurredAt: new Date().toISOString(),
      subjectId: 'service:ledger',
      correlationId,
      attributes: { integrityCode: integrityCode.slice(0, 256) },
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
          'x-aegis-source-token': this.config.riskLedgerSourceToken,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      /* Reconciliation result remains authoritative when telemetry is down. */
    } finally {
      clearTimeout(timeout);
    }
  }
}
