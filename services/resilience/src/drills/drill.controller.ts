import {
  drillHistoryQuerySchema,
  operatorAcknowledgementRequestSchema,
  recordPlannedDrillRequestSchema,
} from '@aegis/contracts';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { DrillService } from './drill.service';

/*
 * Internal API.
 *
 * Every route here is behind the internal-token guard and is reached only by the
 * Gateway or by trusted operator tooling — never by a browser directly. There is
 * deliberately no endpoint that runs a backup, a restore or any shell command;
 * those are CLI-only, and this service records what they report.
 */

const opaqueIdentifier = z.string().regex(/^[A-Za-z0-9:_-]{8,128}$/u);

/** Tooling-reported progress. Validated as strictly as browser input. */
const advanceRequestSchema = z
  .object({
    state: z.enum([
      'RUNNING',
      'BACKUP_CREATED',
      'RESTORE_VERIFIED',
      'RECONCILIATION_PASSED',
      'PASSED',
      'FAILED',
      'CLEANED_UP',
    ]),
    note: z.string().trim().max(500).optional(),
    backupSetId: opaqueIdentifier.optional(),
    measuredRecoveryPointAgeSeconds: z.number().int().nonnegative().optional(),
    measuredRecoveryDurationMs: z.number().int().nonnegative().optional(),
    failureCode: z
      .enum([
        'BACKUP_FAILED',
        'MANIFEST_INVALID',
        'CHECKSUM_MISMATCH',
        'DECRYPTION_FAILED',
        'INCOMPLETE_BACKUP_SET',
        'RESTORE_FAILED',
        'RECONCILIATION_FAILED',
        'CLEANUP_FAILED',
        'DEPENDENCY_UNAVAILABLE',
        'CONFIGURATION_INVALID',
      ])
      .optional(),
    reconciliations: z
      .array(
        z
          .object({
            service: z.enum([
              'identity',
              'ledger',
              'payments',
              'risk',
              'resilience',
            ]),
            status: z.enum(['PASS', 'FAIL']),
            issueCount: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(16)
      .optional(),
  })
  .strict();

const recordBackupSchema = z
  .object({
    backupSetId: opaqueIdentifier,
    createdAt: z.iso.datetime(),
    services: z
      .array(z.enum(['identity', 'ledger', 'payments', 'risk', 'resilience']))
      .min(1)
      .max(16),
    manifestChecksum: z.string().regex(/^[0-9a-f]{64}$/u),
    encryptionAlgorithm: z.literal('AES-256-GCM'),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

const operatorHeaderSchema = z.string().regex(/^[A-Za-z0-9:_-]{8,128}$/u);

@Controller('internal/v1')
export class DrillController {
  constructor(private readonly drills: DrillService) {}

  @Post('backup-sets')
  async recordBackupSet(@Body() body: unknown) {
    const input = recordBackupSchema.parse(body);
    return this.drills.recordBackupSet({
      ...input,
      createdAt: new Date(input.createdAt),
    });
  }

  @Post('backup-sets/:backupSetId/verified')
  async markVerified(@Param('backupSetId') backupSetId: string) {
    return this.drills.markBackupVerified(opaqueIdentifier.parse(backupSetId));
  }

  @Post('drills')
  async createDrill(
    @Body() body: unknown,
    @Query('requestedBy') requestedBy?: string,
  ) {
    const input = recordPlannedDrillRequestSchema.parse(body);
    return this.drills.createDrill({
      type: input.type,
      // The caller states who asked for the drill; the Gateway supplies the
      // authenticated operator, and tooling supplies its own automation identity.
      requestedBy: operatorHeaderSchema.parse(
        requestedBy ?? 'operator:tooling',
      ),
      note: input.note,
    });
  }

  @Post('drills/:drillId/advance')
  async advance(@Param('drillId') drillId: string, @Body() body: unknown) {
    const input = advanceRequestSchema.parse(body);
    return this.drills.advance({
      drillId: opaqueIdentifier.parse(drillId),
      ...input,
    });
  }

  @Post('drills/:drillId/acknowledge')
  async acknowledge(
    @Param('drillId') drillId: string,
    @Body() body: unknown,
    @Query('operatorId') operatorId?: string,
  ) {
    const input = operatorAcknowledgementRequestSchema.parse(body);
    return this.drills.acknowledge(
      opaqueIdentifier.parse(drillId),
      operatorHeaderSchema.parse(operatorId ?? 'operator:unknown'),
      input.reason,
    );
  }

  @Get('drills')
  async history(@Query() query: unknown) {
    const parsed = drillHistoryQuerySchema.parse(query ?? {});
    return this.drills.history(parsed);
  }

  @Get('drills/:drillId')
  async detail(@Param('drillId') drillId: string) {
    return this.drills.load(opaqueIdentifier.parse(drillId));
  }

  @Get('drills/:drillId/events')
  async events(@Param('drillId') drillId: string) {
    return {
      events: await this.drills.events(opaqueIdentifier.parse(drillId)),
    };
  }
}
