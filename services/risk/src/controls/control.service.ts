import type { ControlScope, ControlType } from '@aegis/contracts';
import { Injectable } from '@nestjs/common';
import { sha256 } from '../common/security/security';
import { PrismaService } from '../database/prisma.service';
import { IdentityControlClient } from './identity-control.client';
@Injectable()
export class ControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityControlClient,
  ) {}
  async expire() {
    const rows = await this.prisma.client.controlAction.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: new Date() } },
      select: { id: true },
      take: 500,
    });
    for (const row of rows)
      await this.prisma.client.controlAction.update({
        where: { id: row.id },
        data: {
          status: 'EXPIRED',
          events: {
            create: {
              eventType: 'EXPIRED',
              actorId: 'automated:expiry-job',
              reason: 'Configured control expiry reached.',
            },
          },
        },
      });
    return { expired: rows.length };
  }
  async check(scopes: Array<{ type: ControlScope; id: string }>) {
    await this.expire();
    const rows = await this.prisma.client.controlAction.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
        OR: scopes.map((scope) => ({
          scopeType: scope.type,
          scopeId: scope.id,
        })),
      },
      orderBy: { createdAt: 'asc' },
    });
    const types = rows.map((row) => row.type);
    const quarantine = types.includes('QUARANTINE');
    const blocked =
      quarantine ||
      types.some((type) =>
        ['TEMPORARY_BLOCK', 'ACCOUNT_RESTRICT', 'RECIPIENT_BLOCK'].includes(
          type,
        ),
      );
    const held = types.some((type) =>
      ['TRANSFER_HOLD', 'MANUAL_REVIEW'].includes(type),
    );
    const stepUp = types.includes('REQUIRE_STEP_UP');
    return {
      allowed: !blocked && !held,
      decision: quarantine
        ? 'QUARANTINE'
        : blocked
          ? 'BLOCK'
          : held
            ? 'HOLD_FOR_REVIEW'
            : stepUp
              ? 'REQUIRE_STEP_UP'
              : 'ALLOW',
      reasonCodes: [...new Set(rows.map((row) => row.reasonCode))],
      requiresStepUp: stepUp,
      expiresAt: rows.length
        ? new Date(
            Math.min(...rows.map((row) => row.expiresAt.getTime())),
          ).toISOString()
        : null,
    };
  }
  async apply(
    input: {
      idempotencyKey: string;
      type: ControlType;
      scopeType: ControlScope;
      scopeId: string;
      reasonCode: string;
      expiresAt: string;
      incidentId?: string;
    },
    operatorId: string,
  ) {
    const hash = sha256(input.idempotencyKey);
    const existing = await this.prisma.client.controlAction.findUnique({
      where: { idempotencyKeyHash: hash },
    });
    if (existing) {
      if (existing.type === 'SESSION_REVOKE')
        await this.identity.revokeSession(
          existing.scopeId,
          existing.id,
          existing.reasonCode,
        );
      return existing;
    }
    const created = await this.prisma.client.controlAction.create({
      data: {
        idempotencyKeyHash: hash,
        type: input.type,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        reasonCode: input.reasonCode,
        incidentId: input.incidentId,
        createdBy: operatorId,
        expiresAt: new Date(input.expiresAt),
        events: {
          create: {
            eventType: 'CREATED',
            actorId: operatorId,
            reason: input.reasonCode,
          },
        },
      },
    });
    if (created.type === 'SESSION_REVOKE')
      await this.identity.revokeSession(
        created.scopeId,
        created.id,
        created.reasonCode,
      );
    return created;
  }
  async release(id: string, reason: string, operatorId: string) {
    const current = await this.prisma.client.controlAction.findUniqueOrThrow({
      where: { id },
    });
    if (current.status !== 'ACTIVE') return current;
    return this.prisma.client.controlAction.update({
      where: { id },
      data: {
        status: 'RELEASED',
        events: {
          create: { eventType: 'RELEASED', actorId: operatorId, reason },
        },
      },
    });
  }
}
