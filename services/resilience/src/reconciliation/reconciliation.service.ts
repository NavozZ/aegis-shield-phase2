import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

/*
 * Resilience reconciliation.
 *
 * Checks that the recovery *evidence* is internally consistent. It does not
 * re-verify backups — that requires the encryption key and is the tooling's job —
 * it verifies the claims this database makes about itself, which is what an
 * operator is trusting when they read the console after an incident.
 */

export interface ResilienceReconciliationResult {
  status: 'PASS' | 'FAIL';
  checkedDrills: number;
  checkedBackupSets: number;
  issueCount: number;
  issues: { code: string; severity: 'WARNING' | 'CRITICAL'; count: number }[];
}

@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async reconcile(): Promise<ResilienceReconciliationResult> {
    const issues: ResilienceReconciliationResult['issues'] = [];
    const add = (
      code: string,
      severity: 'WARNING' | 'CRITICAL',
      count: number,
    ) => {
      if (count > 0) issues.push({ code, severity, count });
    };

    const [drills, backupSets] = await Promise.all([
      this.prisma.client.recoveryDrill.findMany({
        include: { events: true, reconciliations: true, backupSet: true },
        orderBy: { startedAt: 'desc' },
        take: 500,
      }),
      this.prisma.client.backupSet.findMany({ take: 500 }),
    ]);

    // Every drill must have at least the event that created it. A drill with no
    // history is evidence that cannot be audited.
    add(
      'DRILL_WITHOUT_HISTORY',
      'CRITICAL',
      drills.filter((drill) => drill.events.length === 0).length,
    );

    // A passing drill must have reached a verified restore and a reconciliation.
    add(
      'PASSED_WITHOUT_RESTORE_EVIDENCE',
      'CRITICAL',
      drills.filter(
        (drill) =>
          drill.state === 'PASSED' &&
          !drill.events.some((event) => event.state === 'RESTORE_VERIFIED'),
      ).length,
    );
    add(
      'PASSED_WITHOUT_RECONCILIATION',
      'CRITICAL',
      drills.filter(
        (drill) =>
          drill.state === 'PASSED' &&
          drill.reconciliations.every((item) => item.status !== 'PASS'),
      ).length,
    );

    // A passing drill must name the backup set it restored.
    add(
      'PASSED_WITHOUT_BACKUP_SET',
      'CRITICAL',
      drills.filter((drill) => drill.state === 'PASSED' && !drill.backupSetId)
        .length,
    );

    // A failed drill that nobody has acknowledged is the operational signal the
    // console exists to surface. A warning, not a failure: it is a to-do.
    add(
      'UNACKNOWLEDGED_FAILED_DRILL',
      'WARNING',
      drills.filter(
        (drill) => drill.state === 'FAILED' && !drill.acknowledgedAt,
      ).length,
    );

    // A drill left mid-flight means tooling died without recording an outcome.
    add(
      'DRILL_STUCK_IN_PROGRESS',
      'WARNING',
      drills.filter((drill) =>
        ['RUNNING', 'BACKUP_CREATED', 'RESTORE_VERIFIED'].includes(drill.state),
      ).length,
    );

    // A backup set nothing has ever verified may not be restorable.
    add(
      'UNVERIFIED_BACKUP_SET',
      'WARNING',
      backupSets.filter((set) => !set.verified).length,
    );

    const critical = issues.filter((issue) => issue.severity === 'CRITICAL');
    return {
      // Warnings are reported but do not fail the run, matching how the Ledger
      // and Payments reconciliations already treat advisory findings.
      status: critical.length === 0 ? 'PASS' : 'FAIL',
      checkedDrills: drills.length,
      checkedBackupSets: backupSets.length,
      issueCount: issues.reduce((total, issue) => total + issue.count, 0),
      issues,
    };
  }
}
