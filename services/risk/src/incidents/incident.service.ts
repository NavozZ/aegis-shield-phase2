import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
@Injectable()
export class IncidentService {
  constructor(private readonly prisma: PrismaService) {}
  list(cursor?: { timestamp: string; id: string }) {
    return this.prisma.client.incident.findMany({
      where: cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.timestamp) } },
              {
                createdAt: new Date(cursor.timestamp),
                id: { lt: cursor.id },
              },
            ],
          }
        : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
      include: { assessment: true, controls: true },
    });
  }
  detail(id: string) {
    return this.prisma.client.incident.findUniqueOrThrow({
      where: { id },
      include: {
        assessment: true,
        controls: { include: { events: true } },
        events: { orderBy: { occurredAt: 'asc' } },
      },
    });
  }
  async update(
    id: string,
    input: {
      status?:
        'OPEN' | 'INVESTIGATING' | 'CONTAINED' | 'RESOLVED' | 'FALSE_POSITIVE';
      assignedTo?: string;
      note?: string;
      resolutionReason?: string;
    },
    operatorId: string,
  ) {
    const current = await this.prisma.client.incident.findUniqueOrThrow({
      where: { id },
    });
    const resolved = ['RESOLVED', 'FALSE_POSITIVE'].includes(
      input.status || '',
    );
    if (resolved && !input.resolutionReason)
      throw new Error('A resolution reason is required.');
    return this.prisma.client.incident.update({
      where: { id },
      data: {
        status: input.status,
        assignedTo: input.assignedTo,
        resolutionReason: input.resolutionReason,
        resolvedAt: resolved
          ? new Date()
          : input.status === 'OPEN'
            ? null
            : undefined,
        events: {
          create: {
            eventType:
              input.status === 'OPEN' &&
              ['RESOLVED', 'FALSE_POSITIVE'].includes(current.status)
                ? 'REOPENED'
                : input.status
                  ? 'STATUS_CHANGED'
                  : input.assignedTo
                    ? 'ASSIGNED'
                    : 'NOTE_ADDED',
            actorId: operatorId,
            note: input.note || input.resolutionReason || input.assignedTo,
          },
        },
      },
    });
  }
}
