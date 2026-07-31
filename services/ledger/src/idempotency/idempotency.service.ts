import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  LEDGER_CONFIG,
  type LedgerConfig,
} from '../common/config/ledger.config';
import {
  idempotencyConflictError,
  idempotencyInProgressError,
} from '../common/errors/ledger.error';
import {
  canonicalRequestHash,
  idempotencyFingerprint,
  sha256,
  timingSafeStringEqual,
} from '../common/security/security';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';

export const IDEMPOTENCY_SCOPES = {
  defaultCustomerAccount: 'customer-account:default',
  journalEntry: 'journal-entry',
} as const;

export type IdempotencyScope =
  (typeof IDEMPOTENCY_SCOPES)[keyof typeof IDEMPOTENCY_SCOPES];

export interface IdempotentOutcome<T> {
  result: T;
  replayed: boolean;
}

interface ExecuteOptions<T> {
  scope: IdempotencyScope;
  idempotencyKey: string;
  /** Canonicalised and hashed; never stored or logged in raw form. */
  payload: unknown;
  run: (tx: Prisma.TransactionClient) => Promise<T>;
  encode: (value: T) => Prisma.InputJsonValue;
  decode: (value: unknown) => T;
}

/** Extracts the constraint target from a Prisma unique-violation error. */
function uniqueViolationTarget(error: unknown): string | undefined {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('code' in error) ||
    (error as { code?: unknown }).code !== 'P2002'
  ) {
    return undefined;
  }
  const meta = (error as { meta?: { target?: unknown } }).meta;
  const target = meta?.target;
  if (typeof target === 'string') return target;
  if (Array.isArray(target)) return target.join(',');
  return '';
}

export function isIdempotencyConflict(error: unknown): boolean {
  const target = uniqueViolationTarget(error);
  // An empty target still indicates P2002; the record lookup that follows
  // resolves whether it was in fact the idempotency constraint.
  return (
    target !== undefined && !/customer_accounts|journal_entries/u.test(target)
  );
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger('LedgerIdempotency');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LEDGER_CONFIG) private readonly config: LedgerConfig,
  ) {}

  private expiry(): Date {
    return new Date(
      Date.now() + this.config.idempotencyRetentionHours * 3_600_000,
    );
  }

  /**
   * Runs `work` exactly once per (scope, idempotency key).
   *
   * The reservation row is written inside the same transaction as the work, so
   * a concurrent duplicate blocks on the unique index instead of executing
   * twice. When the first transaction commits, the duplicate observes the
   * conflict and replays the stored response.
   */
  async execute<T>(options: ExecuteOptions<T>): Promise<IdempotentOutcome<T>> {
    const keyHash = sha256(options.idempotencyKey);
    const requestHash = canonicalRequestHash(options.payload);

    const settled = await this.replayIfSettled(
      options,
      keyHash,
      requestHash,
      false,
    );
    if (settled) return settled;

    try {
      const result = await this.prisma.client.$transaction(async (tx) => {
        await tx.idempotencyRecord.create({
          data: {
            scope: options.scope,
            keyHash,
            requestHash,
            status: 'IN_PROGRESS',
            expiresAt: this.expiry(),
          },
        });
        const value = await options.run(tx);
        await tx.idempotencyRecord.update({
          where: { scope_keyHash: { scope: options.scope, keyHash } },
          data: { status: 'COMPLETED', responseBody: options.encode(value) },
        });
        return value;
      });
      return { result, replayed: false };
    } catch (error) {
      if (!isIdempotencyConflict(error)) throw error;
      this.logger.log(
        JSON.stringify({
          event: 'idempotent_replay',
          scope: options.scope,
          key: idempotencyFingerprint(options.idempotencyKey),
        }),
      );
      const replayed = await this.replayIfSettled(
        options,
        keyHash,
        requestHash,
        true,
      );
      if (replayed) return replayed;
      throw idempotencyInProgressError();
    }
  }

  private async replayIfSettled<T>(
    options: ExecuteOptions<T>,
    keyHash: string,
    requestHash: string,
    conflicted: boolean,
  ): Promise<IdempotentOutcome<T> | undefined> {
    const existing = await this.prisma.client.idempotencyRecord.findUnique({
      where: { scope_keyHash: { scope: options.scope, keyHash } },
    });
    if (!existing) return undefined;

    if (!timingSafeStringEqual(existing.requestHash, requestHash)) {
      throw idempotencyConflictError();
    }
    if (existing.status !== 'COMPLETED' || existing.responseBody === null) {
      // A reservation exists but its transaction has not committed. Retrying
      // is safe; executing concurrently is not.
      if (conflicted) throw idempotencyInProgressError();
      return undefined;
    }
    return { result: options.decode(existing.responseBody), replayed: true };
  }
}
