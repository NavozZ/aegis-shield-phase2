import {
  applyControlRequestSchema,
  releaseControlRequestSchema,
} from '@aegis/contracts';
import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import { PrismaService } from '../database/prisma.service';
import { ControlService } from '../controls/control.service';
import { IncidentService } from '../incidents/incident.service';
import { OperatorService } from './operator.service';
const bootstrapSchema = z
  .object({ accessToken: z.string().min(16).max(256) })
  .strict();
const incidentUpdateSchema = z
  .object({
    status: z
      .enum([
        'OPEN',
        'INVESTIGATING',
        'CONTAINED',
        'RESOLVED',
        'FALSE_POSITIVE',
      ])
      .optional(),
    assignedTo: z.string().min(8).max(128).optional(),
    note: z.string().trim().min(3).max(1000).optional(),
    resolutionReason: z.string().trim().min(8).max(500).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
const cursorSchema = z.object({
  timestamp: z.iso.datetime(),
  id: z.uuid(),
});
function decodeCursor(value?: string) {
  if (!value) return undefined;
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
  } catch {
    throw new BadRequestException('The pagination cursor is invalid.');
  }
}
@Controller('internal/v1/operators')
export class OperatorController {
  constructor(
    private readonly operators: OperatorService,
    private readonly prisma: PrismaService,
    private readonly controls: ControlService,
    private readonly incidents: IncidentService,
  ) {}
  private token(request: Request) {
    return request.header('x-aegis-operator-session')?.trim() || '';
  }
  private csrf(request: Request) {
    return request.header('x-csrf-token')?.trim();
  }
  @Post('bootstrap') bootstrap(@Body() body: unknown) {
    return this.operators.bootstrap(bootstrapSchema.parse(body).accessToken);
  }
  @Post('validate') async validate(@Req() request: Request) {
    return this.operators.validate(this.token(request));
  }
  @Post('logout') async logout(@Req() request: Request) {
    await this.operators.validate(
      this.token(request),
      this.csrf(request),
      true,
    );
    return this.operators.revoke(this.token(request));
  }
  @Get('overview') async overview(@Req() request: Request) {
    await this.operators.validate(this.token(request));
    const since = new Date(Date.now() - 86_400_000);
    const [
      eventsLast24Hours,
      activeControls,
      openIncidents,
      highCriticalAssessments,
      bands,
      sources,
    ] = await Promise.all([
      this.prisma.client.securityEvent.count({
        where: { receivedAt: { gte: since } },
      }),
      this.prisma.client.controlAction.count({
        where: { status: 'ACTIVE', expiresAt: { gt: new Date() } },
      }),
      this.prisma.client.incident.count({
        where: { status: { in: ['OPEN', 'INVESTIGATING', 'CONTAINED'] } },
      }),
      this.prisma.client.riskAssessment.count({
        where: {
          band: { in: ['HIGH', 'CRITICAL'] },
          createdAt: { gte: since },
        },
      }),
      this.prisma.client.riskAssessment.groupBy({
        by: ['band'],
        _count: { _all: true },
        where: { createdAt: { gte: since } },
      }),
      this.prisma.client.sourceHealth.findMany({ orderBy: { source: 'asc' } }),
    ]);
    const riskDistribution = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    for (const band of bands) riskDistribution[band.band] = band._count._all;
    return {
      eventsLast24Hours,
      activeControls,
      openIncidents,
      highCriticalAssessments,
      riskDistribution,
      sourceHealth: sources.map((source) => ({
        source: source.source,
        lastReceivedAt: source.lastReceivedAt.toISOString(),
        stale: Date.now() - source.lastReceivedAt.getTime() > 900_000,
      })),
    };
  }
  @Get('events') async events(
    @Req() request: Request,
    @Query('cursor') cursor?: string,
  ) {
    await this.operators.validate(this.token(request));
    const after = decodeCursor(cursor);
    return this.prisma.client.securityEvent.findMany({
      where: after
        ? {
            OR: [
              { receivedAt: { lt: new Date(after.timestamp) } },
              {
                receivedAt: new Date(after.timestamp),
                id: { lt: after.id },
              },
            ],
          }
        : {},
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: 51,
    });
  }
  @Get('assessments') async assessments(
    @Req() request: Request,
    @Query('cursor') cursor?: string,
  ) {
    await this.operators.validate(this.token(request));
    const after = decodeCursor(cursor);
    return this.prisma.client.riskAssessment.findMany({
      where: after
        ? {
            OR: [
              { createdAt: { lt: new Date(after.timestamp) } },
              {
                createdAt: new Date(after.timestamp),
                id: { lt: after.id },
              },
            ],
          }
        : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
    });
  }
  @Get('controls') async controlList(
    @Req() request: Request,
    @Query('cursor') cursor?: string,
  ) {
    await this.operators.validate(this.token(request));
    const after = decodeCursor(cursor);
    return this.prisma.client.controlAction.findMany({
      where: after
        ? {
            OR: [
              { createdAt: { lt: new Date(after.timestamp) } },
              {
                createdAt: new Date(after.timestamp),
                id: { lt: after.id },
              },
            ],
          }
        : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
      include: { events: true },
    });
  }
  @Get('incidents') async incidentList(
    @Req() request: Request,
    @Query('cursor') cursor?: string,
  ) {
    await this.operators.validate(this.token(request));
    return this.incidents.list(decodeCursor(cursor));
  }
  @Get('incidents/:id') async incident(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    await this.operators.validate(this.token(request));
    return this.incidents.detail(z.uuid().parse(id));
  }
  @Post('controls') async apply(
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    const operator = await this.operators.validate(
      this.token(request),
      this.csrf(request),
      true,
    );
    const input = applyControlRequestSchema.parse(body);
    const control = await this.controls.apply(input, operator.operatorId);
    await this.audit(
      operator.operatorId,
      'CONTROL_APPLY',
      'CONTROL',
      control.id,
      input.reasonCode,
      request,
    );
    return control;
  }
  @Post('controls/:id/release') async release(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const operator = await this.operators.validate(
      this.token(request),
      this.csrf(request),
      true,
    );
    const input = releaseControlRequestSchema.parse(body);
    const control = await this.controls.release(
      z.uuid().parse(id),
      input.reason,
      operator.operatorId,
    );
    await this.audit(
      operator.operatorId,
      'CONTROL_RELEASE',
      'CONTROL',
      control.id,
      input.reason,
      request,
    );
    return control;
  }
  @Post('incidents/:id') async updateIncident(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const operator = await this.operators.validate(
      this.token(request),
      this.csrf(request),
      true,
    );
    const input = incidentUpdateSchema.parse(body);
    const incident = await this.incidents.update(
      z.uuid().parse(id),
      input,
      operator.operatorId,
    );
    await this.audit(
      operator.operatorId,
      'INCIDENT_UPDATE',
      'INCIDENT',
      incident.id,
      input.note || input.resolutionReason || input.status || 'assignment',
      request,
    );
    return incident;
  }
  private async audit(
    operatorId: string,
    action: string,
    targetType: string,
    targetId: string,
    reason: string,
    request: Request,
  ) {
    const supplied = request.header('x-correlation-id') || '';
    await this.prisma.client.operatorAudit.create({
      data: {
        operatorId,
        action,
        targetType,
        targetId,
        reason,
        correlationId: z.uuid().safeParse(supplied).success
          ? supplied
          : crypto.randomUUID(),
      },
    });
  }
}
