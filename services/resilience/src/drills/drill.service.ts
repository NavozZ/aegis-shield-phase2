import type {
  BackupSetSummary,
  RecoveryDrill,
  RecoveryDrillState,
  ResilienceFailureCode,
} from '@aegis/contracts';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';

/*
 * Recovery drill records.
 *
 * The service never runs a backup or a restore. Backup and restore are operator
 * tooling that touches `pg_dump`, the filesystem and the encryption key; putting
 * any of that behind an HTTP handler would turn a console into remote command
 * execution. What this service owns is the *evidence*: which sets exist, which
 * drills ran, what they measured, and what an operator said about a failure.
 *
 * State transitions are validated because drill evidence is what someone relies
 * on after an incident. A drill that jumped from PLANNED to PASSED without a
 * restore ever being verified would be a lie recorded in an append-only table.
 */

/** Which states may follow which. A terminal state accepts only CLEANED_UP. */
const ALLOWED_TRANSITIONS: Record<RecoveryDrillState, RecoveryDrillState[]> = {
  PLANNED: ['RUNNING', 'FAILED'],
  RUNNING: ['BACKUP_CREATED', 'FAILED'],
  BACKUP_CREATED: ['RESTORE_VERIFIED', 'FAILED'],
  RESTORE_VERIFIED: ['RECONCILIATION_PASSED', 'FAILED'],
  RECONCILIATION_PASSED: ['PASSED', 'FAILED'],
  PASSED: ['CLEANED_UP'],
  FAILED: ['CLEANED_UP'],
  CLEANED_UP: [],
};

export interface RecordBackupSetInput {
  backupSetId: string;
  createdAt: Date;
  services: string[];
  manifestChecksum: string;
  encryptionAlgorithm: string;
  sizeBytes: number;
}

export interface AdvanceDrillInput {
  drillId: string;
  state: RecoveryDrillState;
  note?: string;
  backupSetId?: string;
  measuredRecoveryPointAgeSeconds?: number;
  measuredRecoveryDurationMs?: number;
  failureCode?: ResilienceFailureCode;
  reconciliations?: {
    service: string;
    status: 'PASS' | 'FAIL';
    issueCount: number;
  }[];
}

@Injectable()
export class DrillService {
  constructor(private readonly prisma: PrismaService) {}

  async recordBackupSet(
    input: RecordBackupSetInput,
  ): Promise<BackupSetSummary> {
    const existing = await this.prisma.client.backupSet.findUnique({
      where: { backupSetId: input.backupSetId },
    });
    // Recording the same set twice is idempotent rather than an error: the
    // tooling may retry, and the row is immutable anyway.
    const row =
      existing ??
      (await this.prisma.client.backupSet.create({
        data: {
          backupSetId: input.backupSetId,
          createdAt: input.createdAt,
          services: input.services,
          manifestChecksum: input.manifestChecksum,
          encryptionAlgorithm: input.encryptionAlgorithm,
          sizeBytes: BigInt(input.sizeBytes),
        },
      }));
    return this.toBackupSummary(row);
  }

  async markBackupVerified(backupSetId: string): Promise<BackupSetSummary> {
    const row = await this.prisma.client.backupSet.findUnique({
      where: { backupSetId },
    });
    if (!row) throw new NotFoundException();
    // `verified` is the one mutable field; the trigger rejects any change to
    // the fields that identify the bytes.
    const updated = await this.prisma.client.backupSet.update({
      where: { id: row.id },
      data: { verified: true },
    });
    return this.toBackupSummary(updated);
  }

  async createDrill(input: {
    type: string;
    requestedBy: string;
    note?: string;
  }): Promise<RecoveryDrill> {
    const drillId = `drill:${new Date().toISOString().slice(0, 10)}:${randomUUID().slice(0, 8)}`;
    const drill = await this.prisma.client.recoveryDrill.create({
      data: {
        drillId,
        type: input.type,
        state: 'PLANNED',
        requestedBy: input.requestedBy,
      },
    });
    await this.appendEvent(drill.id, 'PLANNED', input.note ?? null);
    return this.load(drillId);
  }

  /**
   * Moves a drill forward, refusing transitions that would misrepresent it.
   *
   * Terminal and out-of-order moves are a conflict rather than a silent
   * overwrite, so a buggy or hostile caller cannot mark an unverified drill as
   * passed.
   */
  async advance(input: AdvanceDrillInput): Promise<RecoveryDrill> {
    const drill = await this.prisma.client.recoveryDrill.findUnique({
      where: { drillId: input.drillId },
    });
    if (!drill) throw new NotFoundException();

    const current = drill.state as RecoveryDrillState;
    if (!ALLOWED_TRANSITIONS[current].includes(input.state)) {
      throw new ConflictException({
        error: { code: 'INVALID_DRILL_TRANSITION' },
      });
    }

    const terminal = input.state === 'PASSED' || input.state === 'FAILED';
    await this.prisma.client.recoveryDrill.update({
      where: { id: drill.id },
      data: {
        state: input.state,
        completedAt: terminal ? new Date() : drill.completedAt,
        failureCode:
          input.state === 'FAILED' ? (input.failureCode ?? null) : null,
        measuredRecoveryPointAgeSeconds:
          input.measuredRecoveryPointAgeSeconds ??
          drill.measuredRecoveryPointAgeSeconds,
        measuredRecoveryDurationMs:
          input.measuredRecoveryDurationMs ?? drill.measuredRecoveryDurationMs,
        backupSetId: input.backupSetId
          ? (
              await this.prisma.client.backupSet.findUnique({
                where: { backupSetId: input.backupSetId },
              })
            )?.id
          : drill.backupSetId,
      },
    });

    for (const item of input.reconciliations ?? []) {
      // Append-only: a second result for the same service in one drill is a
      // programming error, not something to overwrite.
      await this.prisma.client.drillReconciliation.create({
        data: {
          drillRowId: drill.id,
          service: item.service,
          status: item.status,
          issueCount: item.issueCount,
        },
      });
    }

    await this.appendEvent(drill.id, input.state, input.note ?? null);
    return this.load(input.drillId);
  }

  async acknowledge(
    drillId: string,
    operatorId: string,
    reason: string,
  ): Promise<RecoveryDrill> {
    const drill = await this.prisma.client.recoveryDrill.findUnique({
      where: { drillId },
    });
    if (!drill) throw new NotFoundException();
    if (drill.state !== 'FAILED') {
      // Acknowledgement exists so a failed drill is explicitly reviewed. Letting
      // it apply to a passing drill would dilute what the record means.
      throw new ConflictException({ error: { code: 'DRILL_NOT_FAILED' } });
    }
    if (drill.acknowledgedAt) {
      throw new ConflictException({ error: { code: 'ALREADY_ACKNOWLEDGED' } });
    }
    await this.prisma.client.recoveryDrill.update({
      where: { id: drill.id },
      data: {
        acknowledgedAt: new Date(),
        acknowledgedBy: operatorId,
        acknowledgementReason: reason,
      },
    });
    return this.load(drillId);
  }

  async history(options: {
    limit: number;
    cursor?: string;
    state?: RecoveryDrillState;
  }): Promise<{ drills: RecoveryDrill[]; nextCursor: string | null }> {
    const cursorRow = options.cursor
      ? await this.prisma.client.recoveryDrill.findUnique({
          where: { drillId: options.cursor },
        })
      : null;
    const rows = await this.prisma.client.recoveryDrill.findMany({
      where: {
        ...(options.state ? { state: options.state } : {}),
        ...(cursorRow ? { startedAt: { lt: cursorRow.startedAt } } : {}),
      },
      orderBy: [{ startedAt: 'desc' }, { drillId: 'desc' }],
      // One extra row tells us whether another page exists without a count.
      take: options.limit + 1,
      include: { backupSet: true, reconciliations: true },
    });
    const page = rows.slice(0, options.limit);
    return {
      drills: page.map((row) => this.toDrill(row)),
      nextCursor:
        rows.length > options.limit ? (page.at(-1)?.drillId ?? null) : null,
    };
  }

  async latestDrill(): Promise<RecoveryDrill | null> {
    const row = await this.prisma.client.recoveryDrill.findFirst({
      orderBy: { startedAt: 'desc' },
      include: { backupSet: true, reconciliations: true },
    });
    return row ? this.toDrill(row) : null;
  }

  async latestBackup(): Promise<BackupSetSummary | null> {
    const row = await this.prisma.client.backupSet.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toBackupSummary(row) : null;
  }

  async load(drillId: string): Promise<RecoveryDrill> {
    const row = await this.prisma.client.recoveryDrill.findUnique({
      where: { drillId },
      include: { backupSet: true, reconciliations: true },
    });
    if (!row) throw new NotFoundException();
    return this.toDrill(row);
  }

  async events(drillId: string) {
    const drill = await this.prisma.client.recoveryDrill.findUnique({
      where: { drillId },
    });
    if (!drill) throw new NotFoundException();
    const rows = await this.prisma.client.drillEvent.findMany({
      where: { drillRowId: drill.id },
      orderBy: { occurredAt: 'asc' },
      take: 200,
    });
    return rows.map((row) => ({
      eventId: row.eventId,
      drillId,
      state: row.state as RecoveryDrillState,
      occurredAt: row.occurredAt.toISOString(),
      note: row.note,
    }));
  }

  private async appendEvent(
    drillRowId: string,
    state: RecoveryDrillState,
    note: string | null,
  ): Promise<void> {
    await this.prisma.client.drillEvent.create({
      data: {
        eventId: `event:${randomUUID()}`,
        drillRowId,
        state,
        // Bounded, because an operator note travels to a console.
        note: note ? note.slice(0, 500) : null,
      },
    });
  }

  private toBackupSummary(row: {
    backupSetId: string;
    createdAt: Date;
    services: string[];
    manifestChecksum: string;
    encryptionAlgorithm: string;
    sizeBytes: bigint;
    verified: boolean;
  }): BackupSetSummary {
    return {
      backupSetId: row.backupSetId,
      createdAt: row.createdAt.toISOString(),
      services: row.services as BackupSetSummary['services'],
      manifestChecksum: row.manifestChecksum,
      encryptionAlgorithm: 'AES-256-GCM',
      sizeBytes: Number(row.sizeBytes),
      verified: row.verified,
    };
  }

  private toDrill(row: {
    drillId: string;
    type: string;
    state: string;
    startedAt: Date;
    completedAt: Date | null;
    requestedBy: string;
    measuredRecoveryPointAgeSeconds: number | null;
    measuredRecoveryDurationMs: number | null;
    failureCode: string | null;
    acknowledgedAt: Date | null;
    acknowledgedBy: string | null;
    backupSet?: { backupSetId: string } | null;
    reconciliations?: {
      service: string;
      status: string;
      issueCount: number;
      checkedAt: Date;
    }[];
  }): RecoveryDrill {
    return {
      drillId: row.drillId,
      type: row.type as RecoveryDrill['type'],
      state: row.state as RecoveryDrillState,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      requestedBy: row.requestedBy,
      backupSetId: row.backupSet?.backupSetId ?? null,
      measuredRecoveryPointAgeSeconds: row.measuredRecoveryPointAgeSeconds,
      measuredRecoveryDurationMs: row.measuredRecoveryDurationMs,
      reconciliations: (row.reconciliations ?? []).map((item) => ({
        service: item.service as BackupSetSummary['services'][number],
        status: item.status as 'PASS' | 'FAIL',
        issueCount: item.issueCount,
        checkedAt: item.checkedAt.toISOString(),
      })),
      failureCode: row.failureCode as ResilienceFailureCode | null,
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      acknowledgedBy: row.acknowledgedBy,
    };
  }
}
