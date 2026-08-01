import type { SecurityEventV1 } from '@aegis/contracts';
import {
  Inject,
  Injectable,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { RISK_CONFIG, type RiskConfig } from '../common/config/risk.config';
import { timingSafeStringEqual } from '../common/security/security';
import { PrismaService } from '../database/prisma.service';
import { VelocityService } from './velocity.service';
@Injectable()
export class EventService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly velocity: VelocityService,
    @Inject(RISK_CONFIG) private readonly config: RiskConfig,
  ) {}
  private authenticate(source: string, token: string) {
    const expected = this.config.sourceTokens[source];
    if (!expected || !timingSafeStringEqual(token, expected))
      throw new UnauthorizedException();
  }
  authenticateSourceToken(token: string) {
    if (
      !Object.values(this.config.sourceTokens).some((expected) =>
        timingSafeStringEqual(token, expected),
      )
    )
      throw new UnauthorizedException();
  }
  async ingest(event: SecurityEventV1, sourceToken: string) {
    this.authenticate(event.source, sourceToken);
    const sourceRate = await this.velocity.increment(
      event.source,
      'ingestion-source:60s',
      60,
    );
    if (sourceRate > 1_000)
      throw new HttpException(
        { error: { code: 'SOURCE_RATE_LIMITED' } },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const receivedAt = new Date();
    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.securityEvent.create({
          data: {
            id: event.eventId,
            source: event.source,
            sourceEventId: event.sourceEventId,
            schemaVersion: event.schemaVersion,
            eventType: event.eventType,
            severity: event.severity,
            occurredAt: new Date(event.occurredAt),
            subjectId: event.subjectId,
            accountId: event.accountId,
            sessionId: event.sessionId,
            deviceId: event.deviceId,
            recipientId: event.recipientId,
            correlationId: event.correlationId,
            attributes: event.attributes,
          },
        });
        await tx.sourceHealth.upsert({
          where: { source: event.source },
          create: {
            source: event.source,
            lastEventId: event.eventId,
            lastOccurredAt: new Date(event.occurredAt),
            lastReceivedAt: receivedAt,
            acceptedCount: 1,
          },
          update: {
            lastEventId: event.eventId,
            lastOccurredAt: new Date(event.occurredAt),
            lastReceivedAt: receivedAt,
            acceptedCount: { increment: 1 },
          },
        });
        return row;
      });
      if (event.subjectId) await this.updateVelocity(event);
      return {
        id: created.id,
        duplicate: false,
        receivedAt: created.receivedAt.toISOString(),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing =
          await this.prisma.client.securityEvent.findUniqueOrThrow({
            where: {
              source_sourceEventId: {
                source: event.source,
                sourceEventId: event.sourceEventId,
              },
            },
          });
        await this.prisma.client.sourceHealth.update({
          where: { source: event.source },
          data: { duplicateCount: { increment: 1 } },
        });
        return {
          id: existing.id,
          duplicate: true,
          receivedAt: existing.receivedAt.toISOString(),
        };
      }
      throw error;
    }
  }
  private async updateVelocity(event: SecurityEventV1) {
    const subject = event.subjectId!;
    await this.velocity.increment(subject, 'requests:60s', 60);
    if (
      ['LOGIN_FAILURE', 'PIN_FAILURE', 'OTP_FAILURE', 'ACCOUNT_LOCK'].includes(
        event.eventType,
      )
    )
      await this.velocity.increment(subject, 'auth-failures:600s', 600);
    if (
      ['TRANSFER_PREVIEW', 'TRANSFER_CONFIRMATION'].includes(event.eventType)
    ) {
      await this.velocity.increment(subject, 'transfers:600s', 600);
      const amount = Number(event.attributes.amountMinor || 0);
      if (Number.isSafeInteger(amount) && amount > 0)
        await this.velocity.increment(
          subject,
          'outgoing:86400s',
          86400,
          amount,
        );
    }
    if (event.eventType === 'INSUFFICIENT_FUNDS')
      await this.velocity.increment(subject, 'insufficient:600s', 600);
    if (event.eventType === 'IDEMPOTENCY_CONFLICT')
      await this.velocity.increment(subject, 'idempotency:600s', 600);
    if (['CSRF_FAILURE', 'MALFORMED_REQUEST'].includes(event.eventType))
      await this.velocity.increment(subject, 'invalid-sensitive:600s', 600);
  }
}
