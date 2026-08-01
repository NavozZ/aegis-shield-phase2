import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ControlService } from '../controls/control.service';
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly controls: ControlService,
  ) {}
  async run() {
    const expiry = await this.controls.expire();
    const [
      orphanControls,
      orphanControlEvents,
      orphanIncidentEvents,
      unhandledHigh,
      staleSources,
    ] = await Promise.all([
      this.prisma.client.controlAction.count({
        where: {
          assessmentId: null,
          incidentId: null,
          createdBy: 'automated:risk-engine',
        },
      }),
      this.prisma.client.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT count(*)::bigint AS count FROM "app"."control_events" e LEFT JOIN "app"."control_actions" c ON c.id=e.control_id WHERE c.id IS NULL`,
      this.prisma.client.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT count(*)::bigint AS count FROM "app"."incident_events" e LEFT JOIN "app"."incidents" i ON i.id=e.incident_id WHERE i.id IS NULL`,
      this.prisma.client.riskAssessment.count({
        where: { band: { in: ['HIGH', 'CRITICAL'] }, incidents: { none: {} } },
      }),
      this.prisma.client.sourceHealth.count({
        where: { lastReceivedAt: { lt: new Date(Date.now() - 900_000) } },
      }),
    ]);
    const issues = {
      orphanControls,
      orphanControlEvents: Number(orphanControlEvents[0]?.count || 0),
      orphanIncidentEvents: Number(orphanIncidentEvents[0]?.count || 0),
      unhandledHigh,
      staleSources,
    };
    return {
      status: Object.values(issues).every((value) => value === 0)
        ? 'PASS'
        : 'FAIL',
      expiredControls: expiry.expired,
      issues,
    };
  }
}
