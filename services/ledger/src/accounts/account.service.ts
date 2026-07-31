import {
  provisionDefaultAccountResultSchema,
  type AccountBalance,
  type CustomerAccountDetail,
  type CustomerAccountList,
  type CustomerAccountSummary,
  type InternalProvisionDefaultAccountInput,
  type LedgerAccountClass,
  type ProvisionDefaultAccountResult,
} from '@aegis/contracts';
import { Injectable } from '@nestjs/common';
import { accountNotFoundError } from '../common/errors/ledger.error';
import { advisoryLockKey } from '../common/security/security';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import {
  IDEMPOTENCY_SCOPES,
  IdempotencyService,
} from '../idempotency/idempotency.service';
import { serializeMinorUnits, signedBalanceMinor } from '../money/money';
import {
  generatePublicAccountReference,
  maskAccountReference,
} from './account-reference';

interface AccountRow {
  id: string;
  maskedReference: string;
  productType: 'TIER0_WALLET';
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  currency: string;
  createdAt: Date;
  ledgerAccount: {
    accountClass: LedgerAccountClass;
    balanceProjection: {
      debitTotalMinor: bigint;
      creditTotalMinor: bigint;
      updatedAt: Date;
    } | null;
  };
}

const ACCOUNT_SELECTION = {
  id: true,
  maskedReference: true,
  productType: true,
  status: true,
  currency: true,
  createdAt: true,
  ledgerAccount: {
    select: {
      accountClass: true,
      balanceProjection: {
        select: {
          debitTotalMinor: true,
          creditTotalMinor: true,
          updatedAt: true,
        },
      },
    },
  },
} as const;

/** Reference-generation collisions are astronomically unlikely but not impossible. */
const MAX_REFERENCE_ATTEMPTS = 5;

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  private balanceMinor(row: AccountRow): bigint {
    const projection = row.ledgerAccount.balanceProjection;
    if (!projection) {
      // The database creates a projection with every ledger account, so this
      // only fires if the invariant has been violated outside the service.
      throw new Error('Ledger account is missing its balance projection.');
    }
    return signedBalanceMinor(
      row.ledgerAccount.accountClass,
      projection.debitTotalMinor,
      projection.creditTotalMinor,
    );
  }

  private toSummary(row: AccountRow): CustomerAccountSummary {
    return {
      id: row.id,
      maskedReference: row.maskedReference,
      productType: row.productType,
      status: row.status,
      currency: row.currency,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toDetail(row: AccountRow): CustomerAccountDetail {
    return {
      ...this.toSummary(row),
      balance: {
        currency: row.currency,
        minorUnits: serializeMinorUnits(this.balanceMinor(row)),
      },
    };
  }

  /**
   * Creates the customer's default Tier-0 wallet.
   *
   * The wallet's ledger account is a LIABILITY: customer funds are owed by the
   * platform. No journal entry is written and no opening balance is invented —
   * a new account starts at exactly zero.
   */
  async provisionDefault(
    input: InternalProvisionDefaultAccountInput,
  ): Promise<ProvisionDefaultAccountResult> {
    const { customerId, productType, currency } = input;
    const outcome =
      await this.idempotency.execute<ProvisionDefaultAccountResult>({
        scope: IDEMPOTENCY_SCOPES.defaultCustomerAccount,
        idempotencyKey: input.idempotencyKey,
        payload: { customerId, productType, currency },
        encode: (value) => value as unknown as Prisma.InputJsonValue,
        // A replayed response is re-validated against the contract before it is
        // returned, so a corrupted stored row cannot bypass the schema.
        decode: (value) => provisionDefaultAccountResultSchema.parse(value),
        run: async (tx) => {
          // Serialise concurrent provisioning for this exact account identity so
          // the read-then-create below cannot race.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey(
            `customer-account:${customerId}:${productType}:${currency}`,
          )})`;

          const existing = await tx.customerAccount.findUnique({
            where: {
              customerId_productType_currency: {
                customerId,
                productType,
                currency,
              },
            },
            select: ACCOUNT_SELECTION,
          });
          if (existing) {
            return { account: this.toDetail(existing), created: false };
          }

          const created = await this.createAccount(
            tx,
            customerId,
            productType,
            currency,
          );
          return { account: this.toDetail(created), created: true };
        },
      });
    return outcome.result;
  }

  private async createAccount(
    tx: Prisma.TransactionClient,
    customerId: string,
    productType: 'TIER0_WALLET',
    currency: string,
  ): Promise<AccountRow> {
    for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt += 1) {
      const publicReference = generatePublicAccountReference();
      const collision = await tx.customerAccount.findUnique({
        where: { publicReference },
        select: { id: true },
      });
      if (collision) continue;

      const ledgerAccount = await tx.ledgerAccount.create({
        data: {
          code: `CUST-${publicReference}`,
          name: `Customer wallet ${maskAccountReference(publicReference)}`,
          currency,
          accountClass: 'LIABILITY',
          normalBalance: 'CREDIT',
          // Customer wallets may never go negative. Only explicitly configured
          // system accounts carry an overdraft allowance.
          allowNegativeBalance: false,
        },
        select: { id: true },
      });

      return tx.customerAccount.create({
        data: {
          customerId,
          publicReference,
          maskedReference: maskAccountReference(publicReference),
          productType,
          currency,
          status: 'ACTIVE',
          ledgerAccountId: ledgerAccount.id,
        },
        select: ACCOUNT_SELECTION,
      });
    }
    throw new Error('Could not allocate a unique public account reference.');
  }

  async listForCustomer(customerId: string): Promise<CustomerAccountList> {
    const rows = await this.prisma.client.customerAccount.findMany({
      where: { customerId },
      orderBy: { createdAt: 'asc' },
      take: 32,
      select: ACCOUNT_SELECTION,
    });
    return { accounts: rows.map((row) => this.toSummary(row)) };
  }

  /**
   * Ownership is part of the lookup, not a check applied afterwards, so a valid
   * identifier belonging to another customer is indistinguishable from one that
   * does not exist.
   */
  private async requireOwnedAccount(
    customerId: string,
    accountId: string,
  ): Promise<AccountRow> {
    const row = await this.prisma.client.customerAccount.findFirst({
      where: { id: accountId, customerId },
      select: ACCOUNT_SELECTION,
    });
    if (!row) throw accountNotFoundError();
    return row;
  }

  async getForCustomer(
    customerId: string,
    accountId: string,
  ): Promise<CustomerAccountDetail> {
    return this.toDetail(await this.requireOwnedAccount(customerId, accountId));
  }

  async getBalanceForCustomer(
    customerId: string,
    accountId: string,
  ): Promise<AccountBalance> {
    const row = await this.requireOwnedAccount(customerId, accountId);
    return {
      accountId: row.id,
      balance: {
        currency: row.currency,
        minorUnits: serializeMinorUnits(this.balanceMinor(row)),
      },
      updatedAt: (
        row.ledgerAccount.balanceProjection?.updatedAt ?? row.createdAt
      ).toISOString(),
    };
  }
}
