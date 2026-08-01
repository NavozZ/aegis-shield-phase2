import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
export interface PaymentsReconciliationResult {
  status: 'PASS' | 'FAIL';
  checkedTransfers: number;
  checkedIntents: number;
  issueCount: number;
  issues: Array<{ code: string; severity: 'ERROR' | 'WARNING' }>;
}
@Injectable()
export class PaymentsReconciliationService {
  constructor(private readonly prisma: PrismaService) {}
  async run(): Promise<PaymentsReconciliationResult> {
    const client = this.prisma.client;
    const issues: Array<{ code: string; severity: 'ERROR' | 'WARNING' }> = [];
    const add = (
      code: string,
      severity: 'ERROR' | 'WARNING',
      count: number,
    ) => {
      for (let i = 0; i < Math.min(count, 50 - issues.length); i += 1)
        issues.push({ code, severity });
    };
    const [checkedTransfers, checkedIntents, missing, orphan, bad, stale] =
      await Promise.all([
        client.transfer.count(),
        client.transferIntent.count(),
        client.transfer.count({
          where: {
            status: 'COMPLETED',
            OR: [
              { ledgerJournalId: null },
              { senderPostingId: null },
              { recipientPostingId: null },
            ],
          },
        }),
        client.transferIntent.count({
          where: { consumedAt: { not: null }, transfer: null },
        }),
        client.transfer.count({
          where: { status: 'COMPLETED', failureCode: { not: null } },
        }),
        client.transfer.count({
          where: {
            status: 'PROCESSING',
            updatedAt: { lt: new Date(Date.now() - 30000) },
          },
        }),
      ]);
    add('COMPLETED_TRANSFER_LEDGER_DATA_MISSING', 'ERROR', missing);
    add('CONSUMED_INTENT_WITHOUT_TRANSFER', 'ERROR', orphan);
    add('COMPLETED_TRANSFER_HAS_FAILURE', 'ERROR', bad);
    add('STALE_PROCESSING_TRANSFER', 'WARNING', stale);
    const status = issues.some((issue) => issue.severity === 'ERROR')
      ? 'FAIL'
      : 'PASS';
    await client.reconciliationRun.create({
      data: {
        status,
        checkedTransfers,
        checkedIntents,
        issueCount: issues.length,
        issues,
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });
    return {
      status,
      checkedTransfers,
      checkedIntents,
      issueCount: issues.length,
      issues,
    };
  }
}
