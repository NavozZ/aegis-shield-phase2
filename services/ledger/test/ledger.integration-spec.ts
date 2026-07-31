import { randomUUID } from 'node:crypto';
import { AccountService } from '../src/accounts/account.service';
import {
  createLedgerConfig,
  type LedgerConfig,
} from '../src/common/config/ledger.config';
import { PrismaService } from '../src/database/prisma.service';
import { IdempotencyService } from '../src/idempotency/idempotency.service';
import { JournalService } from '../src/ledger/journal.service';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';

/**
 * Infrastructure-dependent tests. They require the PostgreSQL ledger database
 * with committed migrations applied and therefore run in GitHub Actions, not on
 * a developer machine without Docker.
 */
describe('ledger integration', () => {
  const runId = randomUUID().slice(0, 8);
  let config: LedgerConfig;
  let prisma: PrismaService;
  let accounts: AccountService;
  let journals: JournalService;
  let reconciliation: ReconciliationService;
  let settlementAccountId: string;

  const customerId = randomUUID();
  let walletAccountId: string;
  let walletLedgerAccountId: string;

  async function ledgerAccountIdFor(accountId: string): Promise<string> {
    const [row] = await prisma.client.$queryRaw<
      Array<{ ledger_account_id: string }>
    >`SELECT "ledger_account_id" FROM "app"."customer_accounts" WHERE "id" = ${accountId}::uuid`;
    if (!row) throw new Error('Customer account was not found.');
    return row.ledger_account_id;
  }

  async function projectionOf(
    ledgerAccountId: string,
  ): Promise<{ debit: bigint; credit: bigint; version: number }> {
    const [row] = await prisma.client.$queryRaw<
      Array<{
        debit_total_minor: bigint;
        credit_total_minor: bigint;
        version: number;
      }>
    >`SELECT "debit_total_minor", "credit_total_minor", "version" FROM "app"."balance_projections" WHERE "ledger_account_id" = ${ledgerAccountId}::uuid`;
    if (!row) throw new Error('Balance projection was not found.');
    return {
      debit: BigInt(row.debit_total_minor),
      credit: BigInt(row.credit_total_minor),
      version: Number(row.version),
    };
  }

  function fundWallet(amountMinor: string, key: string) {
    return journals.post(
      {
        entryType: 'SETTLEMENT_FUNDING',
        currency: 'LKR',
        idempotencyKey: key,
        reference: `JRN-${runId}-${key}`.slice(0, 64),
        postings: [
          {
            ledgerAccountId: settlementAccountId,
            direction: 'DEBIT',
            amountMinor,
          },
          {
            ledgerAccountId: walletLedgerAccountId,
            direction: 'CREDIT',
            amountMinor,
          },
        ],
      },
      randomUUID(),
      { type: 'SERVICE', id: 'integration-test' },
    );
  }

  function debitWallet(amountMinor: string, key: string) {
    return journals.post(
      {
        entryType: 'ACCOUNT_ADJUSTMENT',
        currency: 'LKR',
        idempotencyKey: key,
        reference: `JRN-${runId}-${key}`.slice(0, 64),
        postings: [
          {
            ledgerAccountId: walletLedgerAccountId,
            direction: 'DEBIT',
            amountMinor,
          },
          {
            ledgerAccountId: settlementAccountId,
            direction: 'CREDIT',
            amountMinor,
          },
        ],
      },
      randomUUID(),
      { type: 'SERVICE', id: 'integration-test' },
    );
  }

  beforeAll(async () => {
    config = createLedgerConfig();
    prisma = new PrismaService(config);
    await prisma.onModuleInit();
    const idempotency = new IdempotencyService(prisma, config);
    accounts = new AccountService(prisma, idempotency);
    journals = new JournalService(prisma, idempotency, config);
    reconciliation = new ReconciliationService(prisma);

    const [settlement] = await prisma.client.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "app"."ledger_accounts"
      WHERE "system_account_type" = 'PLATFORM_SETTLEMENT_ASSET'
    `;
    if (!settlement) throw new Error('System settlement account is missing.');
    settlementAccountId = settlement.id;
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe('migrations and system chart of accounts', () => {
    it('has applied every committed ledger migration', async () => {
      const tables = await prisma.client.$queryRaw<
        Array<{ table_name: string }>
      >`
        SELECT "table_name" FROM "information_schema"."tables" WHERE "table_schema" = 'app'
      `;
      const names = tables.map((table) => table.table_name);
      for (const expected of [
        'customer_accounts',
        'ledger_accounts',
        'journal_entries',
        'journal_postings',
        'balance_projections',
        'idempotency_records',
        'reconciliation_runs',
      ]) {
        expect(names).toContain(expected);
      }
    });

    it('provisions both system accounts idempotently', async () => {
      const rows = await prisma.client.$queryRaw<
        Array<{ system_account_type: string; allow_negative_balance: boolean }>
      >`
        SELECT "system_account_type", "allow_negative_balance"
        FROM "app"."ledger_accounts"
        WHERE "system_account_type" IS NOT NULL
      `;
      // Sorted in JavaScript: ordering an enum column in PostgreSQL follows the
      // type's declaration order, which is not the assertion's concern here.
      expect(rows.map((row) => row.system_account_type).sort()).toEqual([
        'CUSTOMER_FUNDS_LIABILITY_CONTROL',
        'PLATFORM_SETTLEMENT_ASSET',
      ]);
      expect(rows.every((row) => row.allow_negative_balance)).toBe(true);
    });

    it('creates a balance projection for every ledger account', async () => {
      const [row] = await prisma.client.$queryRaw<Array<{ missing: bigint }>>`
        SELECT COUNT(*) AS missing
        FROM "app"."ledger_accounts" AS account
        LEFT JOIN "app"."balance_projections" AS projection
          ON projection."ledger_account_id" = account."id"
        WHERE projection."ledger_account_id" IS NULL
      `;
      expect(Number(row?.missing ?? 1)).toBe(0);
    });
  });

  describe('account provisioning', () => {
    it('creates a Tier-0 wallet with a zero balance', async () => {
      const result = await accounts.provisionDefault({
        customerId,
        productType: 'TIER0_WALLET',
        currency: 'LKR',
        idempotencyKey: `provision-${runId}-first-attempt`,
      });

      expect(result.created).toBe(true);
      expect(result.account.balance).toEqual({
        currency: 'LKR',
        minorUnits: '0',
      });
      expect(result.account.maskedReference).toMatch(
        /^AEGIS-\*{4}-\*{4}-[A-Z0-9]{4}$/u,
      );
      walletAccountId = result.account.id;
      walletLedgerAccountId = await ledgerAccountIdFor(walletAccountId);
    });

    it('writes no journal entry when an account is opened', async () => {
      const [row] = await prisma.client.$queryRaw<Array<{ total: bigint }>>`
        SELECT COUNT(*) AS total FROM "app"."journal_postings"
        WHERE "ledger_account_id" = ${walletLedgerAccountId}::uuid
      `;
      expect(Number(row?.total ?? -1)).toBe(0);
    });

    it('replays the original response for a repeated idempotency key', async () => {
      const replay = await accounts.provisionDefault({
        customerId,
        productType: 'TIER0_WALLET',
        currency: 'LKR',
        idempotencyKey: `provision-${runId}-first-attempt`,
      });
      expect(replay.account.id).toBe(walletAccountId);
      expect(replay.created).toBe(true);
    });

    it('returns the existing account for a different key', async () => {
      const duplicate = await accounts.provisionDefault({
        customerId,
        productType: 'TIER0_WALLET',
        currency: 'LKR',
        idempotencyKey: `provision-${runId}-second-attempt`,
      });
      expect(duplicate.created).toBe(false);
      expect(duplicate.account.id).toBe(walletAccountId);
    });

    it('rejects a reused key carrying a different payload', async () => {
      await expect(
        accounts.provisionDefault({
          customerId: randomUUID(),
          productType: 'TIER0_WALLET',
          currency: 'LKR',
          idempotencyKey: `provision-${runId}-first-attempt`,
        }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    });

    it('creates exactly one account under concurrent identical requests', async () => {
      const concurrentCustomerId = randomUUID();
      const key = `provision-${runId}-concurrent`;
      const results = await Promise.all([
        accounts.provisionDefault({
          customerId: concurrentCustomerId,
          productType: 'TIER0_WALLET',
          currency: 'LKR',
          idempotencyKey: key,
        }),
        accounts.provisionDefault({
          customerId: concurrentCustomerId,
          productType: 'TIER0_WALLET',
          currency: 'LKR',
          idempotencyKey: key,
        }),
      ]);

      expect(results[0].account.id).toBe(results[1].account.id);
      const [row] = await prisma.client.$queryRaw<Array<{ total: bigint }>>`
        SELECT COUNT(*) AS total FROM "app"."customer_accounts"
        WHERE "customer_id" = ${concurrentCustomerId}::uuid
      `;
      expect(Number(row?.total ?? -1)).toBe(1);
    });

    it('enforces ownership on reads', async () => {
      await expect(
        accounts.getForCustomer(randomUUID(), walletAccountId),
      ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
      await expect(
        accounts.getForCustomer(customerId, walletAccountId),
      ).resolves.toMatchObject({ id: walletAccountId });
    });
  });

  describe('journal posting', () => {
    it('commits a balanced journal and updates both projections', async () => {
      const before = await projectionOf(walletLedgerAccountId);
      const result = await fundWallet('100000', `fund-${runId}-a`);

      expect(result.totalMinor).toBe('100000');
      expect(result.postings).toHaveLength(2);

      const after = await projectionOf(walletLedgerAccountId);
      expect(after.credit - before.credit).toBe(100_000n);
      expect(after.version).toBe(before.version + 1);

      const balance = await accounts.getBalanceForCustomer(
        customerId,
        walletAccountId,
      );
      expect(balance.balance.minorUnits).toBe('100000');
    });

    it('replays an identical journal request without double posting', async () => {
      const before = await projectionOf(walletLedgerAccountId);
      const replay = await fundWallet('100000', `fund-${runId}-a`);
      const after = await projectionOf(walletLedgerAccountId);

      expect(replay.totalMinor).toBe('100000');
      expect(after.credit).toBe(before.credit);
      expect(after.version).toBe(before.version);
    });

    it('rejects a debit larger than the available balance', async () => {
      await expect(
        debitWallet('99999999', `overdraw-${runId}`),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    });

    it('leaves no partial journal behind after a rejected posting', async () => {
      const [row] = await prisma.client.$queryRaw<Array<{ total: bigint }>>`
        SELECT COUNT(*) AS total FROM "app"."journal_entries"
        WHERE "reference" = ${`JRN-${runId}-overdraw-${runId}`}
      `;
      expect(Number(row?.total ?? -1)).toBe(0);
    });

    it('prevents concurrent debits from overspending the balance', async () => {
      const concurrentCustomerId = randomUUID();
      const provisioned = await accounts.provisionDefault({
        customerId: concurrentCustomerId,
        productType: 'TIER0_WALLET',
        currency: 'LKR',
        idempotencyKey: `provision-${runId}-race`,
      });
      const raceLedgerAccountId = await ledgerAccountIdFor(
        provisioned.account.id,
      );

      await journals.post(
        {
          entryType: 'SETTLEMENT_FUNDING',
          currency: 'LKR',
          idempotencyKey: `fund-${runId}-race`,
          reference: `JRN-${runId}-fund-race`,
          postings: [
            {
              ledgerAccountId: settlementAccountId,
              direction: 'DEBIT',
              amountMinor: '1000',
            },
            {
              ledgerAccountId: raceLedgerAccountId,
              direction: 'CREDIT',
              amountMinor: '1000',
            },
          ],
        },
        randomUUID(),
        { type: 'SERVICE', id: 'integration-test' },
      );

      const attempt = (suffix: string) =>
        journals.post(
          {
            entryType: 'ACCOUNT_ADJUSTMENT',
            currency: 'LKR',
            idempotencyKey: `race-${runId}-${suffix}`,
            reference: `JRN-${runId}-race-${suffix}`,
            postings: [
              {
                ledgerAccountId: raceLedgerAccountId,
                direction: 'DEBIT',
                amountMinor: '700',
              },
              {
                ledgerAccountId: settlementAccountId,
                direction: 'CREDIT',
                amountMinor: '700',
              },
            ],
          },
          randomUUID(),
          { type: 'SERVICE', id: 'integration-test' },
        );

      const outcomes = await Promise.allSettled([
        attempt('one'),
        attempt('two'),
      ]);
      const fulfilled = outcomes.filter(
        (outcome) => outcome.status === 'fulfilled',
      );
      const rejected = outcomes.filter(
        (outcome) => outcome.status === 'rejected',
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: 'INSUFFICIENT_FUNDS',
      });

      const projection = await projectionOf(raceLedgerAccountId);
      expect(projection.credit - projection.debit).toBe(300n);
      expect(projection.credit - projection.debit >= 0n).toBe(true);
    });

    it('rejects a journal that mixes currencies', async () => {
      await expect(
        journals.post(
          {
            entryType: 'INTERNAL_TEST',
            currency: 'USD',
            idempotencyKey: `mixed-${runId}`,
            reference: `JRN-${runId}-mixed`,
            postings: [
              {
                ledgerAccountId: settlementAccountId,
                direction: 'DEBIT',
                amountMinor: '100',
              },
              {
                ledgerAccountId: walletLedgerAccountId,
                direction: 'CREDIT',
                amountMinor: '100',
              },
            ],
          },
          randomUUID(),
          { type: 'SERVICE', id: 'integration-test' },
        ),
      ).rejects.toMatchObject({ code: 'CURRENCY_MISMATCH' });
    });
  });

  describe('database-level integrity', () => {
    it('rejects an unbalanced journal at COMMIT even from raw SQL', async () => {
      const entryId = randomUUID();
      await expect(
        prisma.client.$transaction(async (tx) => {
          await tx.$executeRaw`
            INSERT INTO "app"."journal_entries"
              ("id", "reference", "entry_type", "currency", "correlation_id", "effective_at", "created_by_type", "created_by_id")
            VALUES (${entryId}::uuid, ${`JRN-${runId}-raw-unbalanced`}, 'INTERNAL_TEST', 'LKR', ${randomUUID()}::uuid, CURRENT_TIMESTAMP, 'SYSTEM', 'integration-test')
          `;
          await tx.$executeRaw`
            INSERT INTO "app"."journal_postings"
              ("journal_entry_id", "ledger_account_id", "direction", "amount_minor", "currency", "sequence")
            VALUES (${entryId}::uuid, ${settlementAccountId}::uuid, 'DEBIT', 100, 'LKR', 0)
          `;
          await tx.$executeRaw`
            INSERT INTO "app"."journal_postings"
              ("journal_entry_id", "ledger_account_id", "direction", "amount_minor", "currency", "sequence")
            VALUES (${entryId}::uuid, ${walletLedgerAccountId}::uuid, 'CREDIT', 50, 'LKR', 1)
          `;
        }),
      ).rejects.toThrow();

      const [row] = await prisma.client.$queryRaw<Array<{ total: bigint }>>`
        SELECT COUNT(*) AS total FROM "app"."journal_entries" WHERE "id" = ${entryId}::uuid
      `;
      expect(Number(row?.total ?? -1)).toBe(0);
    });

    it('rejects a journal with a single posting at COMMIT', async () => {
      const entryId = randomUUID();
      await expect(
        prisma.client.$transaction(async (tx) => {
          await tx.$executeRaw`
            INSERT INTO "app"."journal_entries"
              ("id", "reference", "entry_type", "currency", "correlation_id", "effective_at", "created_by_type", "created_by_id")
            VALUES (${entryId}::uuid, ${`JRN-${runId}-raw-single`}, 'INTERNAL_TEST', 'LKR', ${randomUUID()}::uuid, CURRENT_TIMESTAMP, 'SYSTEM', 'integration-test')
          `;
          await tx.$executeRaw`
            INSERT INTO "app"."journal_postings"
              ("journal_entry_id", "ledger_account_id", "direction", "amount_minor", "currency", "sequence")
            VALUES (${entryId}::uuid, ${settlementAccountId}::uuid, 'DEBIT', 100, 'LKR', 0)
          `;
        }),
      ).rejects.toThrow();
    });

    it('rejects a non-positive posting amount', async () => {
      const entryId = randomUUID();
      await expect(
        prisma.client.$transaction(async (tx) => {
          await tx.$executeRaw`
            INSERT INTO "app"."journal_entries"
              ("id", "reference", "entry_type", "currency", "correlation_id", "effective_at", "created_by_type", "created_by_id")
            VALUES (${entryId}::uuid, ${`JRN-${runId}-raw-zero`}, 'INTERNAL_TEST', 'LKR', ${randomUUID()}::uuid, CURRENT_TIMESTAMP, 'SYSTEM', 'integration-test')
          `;
          await tx.$executeRaw`
            INSERT INTO "app"."journal_postings"
              ("journal_entry_id", "ledger_account_id", "direction", "amount_minor", "currency", "sequence")
            VALUES (${entryId}::uuid, ${settlementAccountId}::uuid, 'DEBIT', 0, 'LKR', 0)
          `;
        }),
      ).rejects.toThrow();
    });

    it('refuses to update a posted journal entry', async () => {
      await expect(
        prisma.client.$executeRaw`
          UPDATE "app"."journal_entries" SET "description" = 'tampered'
          WHERE "reference" = ${`JRN-${runId}-fund-${runId}-a`}
        `,
      ).rejects.toThrow();
    });

    it('refuses to update or delete a posting', async () => {
      const [posting] = await prisma.client.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "app"."journal_postings"
        WHERE "ledger_account_id" = ${walletLedgerAccountId}::uuid
        LIMIT 1
      `;
      expect(posting).toBeDefined();

      await expect(
        prisma.client
          .$executeRaw`UPDATE "app"."journal_postings" SET "amount_minor" = 1 WHERE "id" = ${posting!.id}::uuid`,
      ).rejects.toThrow();
      await expect(
        prisma.client
          .$executeRaw`DELETE FROM "app"."journal_postings" WHERE "id" = ${posting!.id}::uuid`,
      ).rejects.toThrow();
    });

    it('keeps the posting intact after the rejected mutations', async () => {
      const projection = await projectionOf(walletLedgerAccountId);
      expect(projection.credit).toBeGreaterThanOrEqual(100_000n);
    });
  });

  describe('reconciliation', () => {
    it('passes against a consistent ledger', async () => {
      const result = await reconciliation.run(randomUUID());
      expect(result.status).toBe('PASS');
      expect(result.issues).toEqual([]);
      expect(result.checkedLedgerAccounts).toBeGreaterThan(0);
    });

    it('records the run and exposes it as the latest result', async () => {
      const latest = await reconciliation.latest();
      expect(latest?.status).toBe('PASS');
    });

    it('detects a deliberately corrupted balance projection', async () => {
      const before = await projectionOf(walletLedgerAccountId);
      await prisma.client.$executeRaw`
        UPDATE "app"."balance_projections"
        SET "credit_total_minor" = "credit_total_minor" + 1
        WHERE "ledger_account_id" = ${walletLedgerAccountId}::uuid
      `;
      try {
        const failed = await reconciliation.run(randomUUID());
        expect(failed.status).toBe('FAIL');
        expect(failed.issues.map((issue) => issue.code)).toContain(
          'BALANCE_PROJECTION_DRIFT',
        );
      } finally {
        await prisma.client.$executeRaw`
          UPDATE "app"."balance_projections"
          SET "credit_total_minor" = ${before.credit}
          WHERE "ledger_account_id" = ${walletLedgerAccountId}::uuid
        `;
      }
      const restored = await reconciliation.run(randomUUID());
      expect(restored.status).toBe('PASS');
    });
  });
});
