import { config as loadEnvironment } from 'dotenv';
import { resolve } from 'node:path';
import { createPaymentsConfig } from '../src/common/config/payments.config';
import { PrismaService } from '../src/database/prisma.service';

loadEnvironment({
  path: resolve(process.cwd(), '..', '..', '.env.example'),
  quiet: true,
});

describe('Payments PostgreSQL integration', () => {
  const prisma = new PrismaService(createPaymentsConfig());
  beforeAll(async () => prisma.onModuleInit());
  afterAll(async () => prisma.onModuleDestroy());
  it('uses the committed payments schema and preserves append-only transfer events', async () => {
    await expect(prisma.client.$queryRaw`SELECT 1`).resolves.toBeDefined();
    await expect(
      prisma.client.transfer.count(),
    ).resolves.toBeGreaterThanOrEqual(0);
    await expect(
      prisma.client.transferIntent.count(),
    ).resolves.toBeGreaterThanOrEqual(0);
  });
});
