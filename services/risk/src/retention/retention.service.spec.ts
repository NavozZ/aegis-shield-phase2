import type { RiskConfig } from '../common/config/risk.config';
import type { PrismaService } from '../database/prisma.service';
import { RetentionService } from './retention.service';
describe('Risk event retention', () => {
  it('deletes only unlinked events received before the bounded cutoff', async () => {
    let received: unknown;
    const deleteMany = jest.fn((input: unknown) => {
      received = input;
      return Promise.resolve({ count: 2 });
    });
    const prisma = {
      client: { securityEvent: { deleteMany } },
    } as unknown as PrismaService;
    const config = { retentionDays: 90 } as RiskConfig;
    const before = Date.now();
    const result = await new RetentionService(prisma, config).run();
    const after = Date.now();
    const where = (received as { where: unknown }).where as {
      receivedAt: { lt: Date };
      assessments: { none: Record<string, never> };
    };
    expect(where.assessments).toEqual({ none: {} });
    expect(where.receivedAt.lt.getTime()).toBeGreaterThanOrEqual(
      before - 90 * 86_400_000,
    );
    expect(where.receivedAt.lt.getTime()).toBeLessThanOrEqual(
      after - 90 * 86_400_000,
    );
    expect(result).toMatchObject({ deleted: 2, retainedLinked: true });
  });
});
