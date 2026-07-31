import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { maskPhone, sha256 } from '../../common/security/security';

type SafeMetadataValue = string | number | boolean | null;

export interface AuthEventInput {
  userId?: string;
  eventType: string;
  outcome: 'SUCCESS' | 'FAILURE' | 'ACCEPTED';
  correlationId: string;
  phone?: string;
  ipHash?: string;
  userAgent?: string;
  metadata?: Record<string, SafeMetadataValue>;
}

@Injectable()
export class AuthEventService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuthEventInput): Promise<void> {
    await this.prisma.client.authEvent.create({
      data: {
        userId: input.userId,
        eventType: input.eventType,
        outcome: input.outcome,
        correlationId: input.correlationId,
        maskedActor: input.phone ? maskPhone(input.phone) : 'anonymous',
        ipHash: input.ipHash,
        userAgentHash: input.userAgent ? sha256(input.userAgent) : undefined,
        metadata: input.metadata ?? {},
      },
    });
  }
}
