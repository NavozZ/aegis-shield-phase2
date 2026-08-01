import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { maskPhone, sha256 } from '../../common/security/security';
import { randomUUID } from 'node:crypto';
import { Inject } from '@nestjs/common';
import {
  IDENTITY_CONFIG,
  type IdentityConfig,
} from '../../common/config/identity.config';
import { securityEventV1Schema } from '@aegis/contracts';

type SafeMetadataValue = string | number | boolean | null;

export interface AuthEventInput {
  userId?: string;
  eventType: string;
  outcome: 'SUCCESS' | 'FAILURE' | 'ACCEPTED' | 'LOCKED';
  correlationId: string;
  phone?: string;
  ipHash?: string;
  userAgent?: string;
  metadata?: Record<string, SafeMetadataValue>;
}

@Injectable()
export class AuthEventService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  async record(input: AuthEventInput): Promise<void> {
    const event = await this.prisma.client.authEvent.create({
      data: {
        userId: input.userId,
        eventType: input.eventType,
        outcome: input.outcome,
        correlationId: input.correlationId,
        maskedActor: input.phone ? maskPhone(input.phone) : 'anonymous',
        ipHash: input.ipHash,
        userAgentHash: input.userAgent ? sha256(input.userAgent) : undefined,
        metadata: input.metadata ?? {},
      },
    });
    await this.emitRiskEvent(input, event.id);
  }

  private async emitRiskEvent(input: AuthEventInput, sourceEventId: string) {
    const failed = input.outcome === 'FAILURE' || input.outcome === 'LOCKED';
    const eventType =
      input.eventType === 'SESSION_CONTROL'
        ? 'SESSION_REVOKED'
        : input.eventType.includes('OTP')
          ? failed
            ? 'OTP_FAILURE'
            : 'LOGIN_SUCCESS'
          : input.eventType === 'TRANSFER_STEP_UP'
            ? failed
              ? 'PIN_FAILURE'
              : 'LOGIN_SUCCESS'
            : failed
              ? 'LOGIN_FAILURE'
              : input.eventType.includes('SESSION')
                ? 'SESSION_CREATED'
                : 'LOGIN_SUCCESS';
    const body = securityEventV1Schema.parse({
      schemaVersion: '1.0',
      eventId: randomUUID(),
      source: 'IDENTITY',
      sourceEventId: `identity:${sourceEventId}`,
      eventType,
      severity:
        input.outcome === 'LOCKED' ? 'HIGH' : failed ? 'MEDIUM' : 'INFO',
      occurredAt: eventTimestamp(),
      subjectId: input.userId,
      deviceId: input.userAgent ? sha256(input.userAgent) : undefined,
      correlationId: input.correlationId,
      attributes: { outcome: input.outcome, operation: input.eventType },
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
          'x-aegis-source-token': this.config.riskIdentitySourceToken,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      // Authentication stays available when telemetry is unavailable.
    } finally {
      clearTimeout(timeout);
    }
  }
}

function eventTimestamp(): string {
  return new Date().toISOString();
}
