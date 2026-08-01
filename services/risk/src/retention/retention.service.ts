import { Inject, Injectable } from '@nestjs/common';
import { RISK_CONFIG, type RiskConfig } from '../common/config/risk.config';
import { PrismaService } from '../database/prisma.service';
@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RISK_CONFIG) private readonly config: RiskConfig,
  ) {}
  async run() {
    const before = new Date(
      Date.now() - this.config.retentionDays * 86_400_000,
    );
    const result = await this.prisma.client.securityEvent.deleteMany({
      where: { receivedAt: { lt: before }, assessments: { none: {} } },
    });
    return {
      deleted: result.count,
      retainedLinked: true,
      before: before.toISOString(),
    };
  }
}
