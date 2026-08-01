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
import { TransactionService } from '../src/transactions/transaction.service';
import { CustomerTransferService } from '../src/transfers/customer-transfer.service';

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
  let transactions: TransactionService;
  let customerTransfers: CustomerTransferService;
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
    transactions = new TransactionService(prisma);
    customerTransfers = new CustomerTransferService(prisma, journals);

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

  describe('customer transfers', () => {
    const senderCustomerId = randomUUID();
    const recipientCustomerId = randomUUID();
    let senderAccountId: string;
    let recipientAccountId: string;
    let senderLedgerAccountId: string;
    let recipientLedgerAccountId: string;
    let recipientReference: string;
    let successfulJournalId: string;

    async function provision(customer: string, suffix: string) {
      return accounts.provisionDefault({
        customerId: customer,
        productType: 'TIER0_WALLET',
        currency: 'LKR',
        idempotencyKey: `transfer-provision-${runId}-${suffix}`,
      });
    }

    async function fund(
      ledgerAccountId: string,
      amountMinor: string,
      suffix: string,
    ) {
      return journals.post(
        {
          entryType: 'SETTLEMENT_FUNDING',
          currency: 'LKR',
          idempotencyKey: `transfer-fund-${runId}-${suffix}`,
          reference: `JRN-${runId}-transfer-fund-${suffix}`,
          postings: [
            {
              ledgerAccountId: settlementAccountId,
              direction: 'DEBIT',
              amountMinor,
            },
            {
              ledgerAccountId,
              direction: 'CREDIT',
              amountMinor,
            },
          ],
        },
        randomUUID(),
        { type: 'SERVICE', id: 'transfer-integration-test' },
      );
    }

    function command(
      overrides: Partial<{
        transferId: string;
        transferReference: string;
        senderCustomerId: string;
        sourceAccountId: string;
        recipientReference: string;
        amountMinor: string;
        idempotencyKey: string;
      }> = {},
    ) {
      const transferId = overrides.transferId ?? randomUUID();
      return {
        transferId,
        transferReference:
          overrides.transferReference ?? `AEGIS-TRF-${transferId.slice(0, 12)}`,
        senderCustomerId: overrides.senderCustomerId ?? senderCustomerId,
        sourceAccountId: overrides.sourceAccountId ?? senderAccountId,
        recipientReference: overrides.recipientReference ?? recipientReference,
        amountMinor: overrides.amountMinor ?? '1200',
        currency: 'LKR' as const,
        idempotencyKey: overrides.idempotencyKey ?? `transfer:${transferId}`,
      };
    }

    beforeAll(async () => {
      const sender = await provision(senderCustomerId, 'sender');
      const recipient = await provision(recipientCustomerId, 'recipient');
      senderAccountId = sender.account.id;
      recipientAccountId = recipient.account.id;
      recipientReference = recipient.account.receivingReference;
      senderLedgerAccountId = await ledgerAccountIdFor(senderAccountId);
      recipientLedgerAccountId = await ledgerAccountIdFor(recipientAccountId);
      await fund(senderLedgerAccountId, '5000', 'sender');
    });

    it('posts one CUSTOMER_TRANSFER journal with one debit and one credit', async () => {
      const transfer = command({
        transferId: '70000000-0000-4000-8000-000000000001',
        transferReference: `AEGIS-TRF-${runId}-SUCCESS`,
        idempotencyKey: `transfer-${runId}-success`,
      });
      const result = await customerTransfers.transfer(transfer, randomUUID());
      successfulJournalId = result.journalId;

      expect(result.senderBalanceAfter.minorUnits).toBe('3800');
      expect(result.recipientBalanceAfter.minorUnits).toBe('1200');
      const entries = await prisma.client.$queryRaw<
        Array<{ entry_type: string; posting_count: bigint }>
      >`
        SELECT entry."entry_type", COUNT(posting."id") AS posting_count
        FROM "app"."journal_entries" AS entry
        JOIN "app"."journal_postings" AS posting
          ON posting."journal_entry_id" = entry."id"
        WHERE entry."id" = ${result.journalId}::uuid
        GROUP BY entry."entry_type"
      `;
      expect(entries).toEqual([
        { entry_type: 'CUSTOMER_TRANSFER', posting_count: 2n },
      ]);
      const postings = await prisma.client.$queryRaw<
        Array<{
          ledger_account_id: string;
          direction: string;
          amount_minor: bigint;
        }>
      >`
        SELECT "ledger_account_id", "direction", "amount_minor"
        FROM "app"."journal_postings"
        WHERE "journal_entry_id" = ${result.journalId}::uuid
        ORDER BY "sequence"
      `;
      expect(postings).toEqual([
        {
          ledger_account_id: senderLedgerAccountId,
          direction: 'DEBIT',
          amount_minor: 1200n,
        },
        {
          ledger_account_id: recipientLedgerAccountId,
          direction: 'CREDIT',
          amount_minor: 1200n,
        },
      ]);
    });

    it('replays a lost response without creating another journal', async () => {
      const replay = command({
        transferId: '70000000-0000-4000-8000-000000000001',
        transferReference: `AEGIS-TRF-${runId}-SUCCESS`,
        idempotencyKey: `transfer-${runId}-success`,
      });
      const result = await customerTransfers.transfer(replay, randomUUID());
      expect(result.journalId).toBe(successfulJournalId);
      const [row] = await prisma.client.$queryRaw<Array<{ total: bigint }>>`
        SELECT COUNT(*) AS total FROM "app"."journal_entries"
        WHERE "id" = ${successfulJournalId}::uuid
      `;
      expect(row?.total).toBe(1n);
    });

    it('rejects a changed payload under the same idempotency key', async () => {
      await expect(
        customerTransfers.transfer(
          command({
            transferId: '70000000-0000-4000-8000-000000000001',
            transferReference: `AEGIS-TRF-${runId}-SUCCESS`,
            idempotencyKey: `transfer-${runId}-success`,
            amountMinor: '1201',
          }),
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    });

    it('leaves both balances unchanged after insufficient funds', async () => {
      const senderBefore = await projectionOf(senderLedgerAccountId);
      const recipientBefore = await projectionOf(recipientLedgerAccountId);
      await expect(
        customerTransfers.transfer(
          command({
            amountMinor: '999999',
            idempotencyKey: `transfer-${runId}-insufficient`,
          }),
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
      expect(await projectionOf(senderLedgerAccountId)).toEqual(senderBefore);
      expect(await projectionOf(recipientLedgerAccountId)).toEqual(
        recipientBefore,
      );
    });

    it('rejects self-transfer and wrong ownership without changing balances', async () => {
      const sender = await accounts.getForCustomer(
        senderCustomerId,
        senderAccountId,
      );
      const before = await projectionOf(senderLedgerAccountId);
      await expect(
        customerTransfers.transfer(
          command({ recipientReference: sender.receivingReference }),
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'SELF_TRANSFER' });
      await expect(
        customerTransfers.transfer(
          command({ senderCustomerId: randomUUID() }),
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
      expect(await projectionOf(senderLedgerAccountId)).toEqual(before);
    });

    it('rejects inactive source and recipient accounts', async () => {
      await prisma.client.customerAccount.update({
        where: { id: senderAccountId },
        data: { status: 'FROZEN' },
      });
      try {
        await expect(
          customerTransfers.transfer(command(), randomUUID()),
        ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_ACTIVE' });
      } finally {
        await prisma.client.customerAccount.update({
          where: { id: senderAccountId },
          data: { status: 'ACTIVE' },
        });
      }
      await prisma.client.customerAccount.update({
        where: { id: recipientAccountId },
        data: { status: 'FROZEN' },
      });
      try {
        await expect(
          customerTransfers.transfer(command(), randomUUID()),
        ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_ACTIVE' });
      } finally {
        await prisma.client.customerAccount.update({
          where: { id: recipientAccountId },
          data: { status: 'ACTIVE' },
        });
      }
    });

    it('returns OUTGOING and INCOMING TRANSFER history without metadata', async () => {
      const senderHistory = await transactions.list(
        senderCustomerId,
        senderAccountId,
        { pageSize: 20, category: 'TRANSFER' },
      );
      const recipientHistory = await transactions.list(
        recipientCustomerId,
        recipientAccountId,
        { pageSize: 20, category: 'TRANSFER' },
      );
      expect(senderHistory.transactions).toHaveLength(1);
      expect(senderHistory.transactions[0]).toMatchObject({
        direction: 'OUTGOING',
        category: 'TRANSFER',
        amount: { minorUnits: '1200' },
      });
      expect(recipientHistory.transactions).toHaveLength(1);
      expect(recipientHistory.transactions[0]).toMatchObject({
        direction: 'INCOMING',
        category: 'TRANSFER',
        amount: { minorUnits: '1200' },
      });
      expect(JSON.stringify([senderHistory, recipientHistory])).not.toMatch(
        /metadata|ledgerAccountId|correlationId/iu,
      );
    });

    it('prevents concurrent double-spend from one sender', async () => {
      const raceSenderCustomer = randomUUID();
      const raceRecipientOneCustomer = randomUUID();
      const raceRecipientTwoCustomer = randomUUID();
      const raceSender = await provision(raceSenderCustomer, 'race-sender');
      const raceRecipientOne = await provision(
        raceRecipientOneCustomer,
        'race-recipient-one',
      );
      const raceRecipientTwo = await provision(
        raceRecipientTwoCustomer,
        'race-recipient-two',
      );
      const raceLedgerId = await ledgerAccountIdFor(raceSender.account.id);
      await fund(raceLedgerId, '1000', 'race-sender');
      const attempt = (reference: string, suffix: string) =>
        customerTransfers.transfer(
          command({
            transferId: randomUUID(),
            transferReference: `AEGIS-TRF-${runId}-${suffix}`,
            senderCustomerId: raceSenderCustomer,
            sourceAccountId: raceSender.account.id,
            recipientReference: reference,
            amountMinor: '700',
            idempotencyKey: `transfer-${runId}-${suffix}`,
          }),
          randomUUID(),
        );
      const outcomes = await Promise.allSettled([
        attempt(raceRecipientOne.account.receivingReference, 'race-one'),
        attempt(raceRecipientTwo.account.receivingReference, 'race-two'),
      ]);
      expect(
        outcomes.filter((outcome) => outcome.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        outcomes.filter((outcome) => outcome.status === 'rejected'),
      ).toHaveLength(1);
      const projection = await projectionOf(raceLedgerId);
      expect(projection.credit - projection.debit).toBe(300n);
    });

    it('processes opposite-direction transfers without deadlock', async () => {
      await fund(recipientLedgerAccountId, '1000', 'recipient-opposite');
      const outcomes = await Promise.all([
        customerTransfers.transfer(
          command({
            transferId: randomUUID(),
            transferReference: `AEGIS-TRF-${runId}-FORWARD`,
            amountMinor: '100',
            idempotencyKey: `transfer-${runId}-forward`,
          }),
          randomUUID(),
        ),
        customerTransfers.transfer(
          command({
            transferId: randomUUID(),
            transferReference: `AEGIS-TRF-${runId}-REVERSE`,
            senderCustomerId: recipientCustomerId,
            sourceAccountId: recipientAccountId,
            recipientReference: (
              await accounts.getForCustomer(senderCustomerId, senderAccountId)
            ).receivingReference,
            amountMinor: '100',
            idempotencyKey: `transfer-${runId}-reverse`,
          }),
          randomUUID(),
        ),
      ]);
      expect(outcomes).toHaveLength(2);
    });

    it('keeps transfer journals and postings immutable', async () => {
      await expect(
        prisma.client.$executeRaw`
          UPDATE "app"."journal_entries" SET "description" = 'tampered'
          WHERE "id" = ${successfulJournalId}::uuid
        `,
      ).rejects.toThrow();
      await expect(
        prisma.client.$executeRaw`
          DELETE FROM "app"."journal_postings"
          WHERE "journal_entry_id" = ${successfulJournalId}::uuid
        `,
      ).rejects.toThrow();
      const [row] = await prisma.client.$queryRaw<Array<{ total: bigint }>>`
        SELECT COUNT(*) AS total FROM "app"."journal_postings"
        WHERE "journal_entry_id" = ${successfulJournalId}::uuid
      `;
      expect(row?.total).toBe(2n);
    });
  });

  describe('customer transaction history', () => {
    it('returns the funded wallet posting with an authoritative balance', async () => {
      const result = await transactions.list(customerId, walletAccountId, {
        pageSize: 20,
      });
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]).toMatchObject({
        direction: 'INCOMING',
        category: 'FUNDING',
        amount: { minorUnits: '100000' },
        balanceAfter: { minorUnits: '100000' },
      });
      expect(JSON.stringify(result)).not.toContain(walletLedgerAccountId);
    });

    it('derives outgoing history and preserves exact large balances', async () => {
      await debitWallet('25000', `debit-${runId}-history`);
      await fundWallet('9007199254740993', `fund-${runId}-huge`);
      const result = await transactions.list(customerId, walletAccountId, {
        pageSize: 20,
      });
      expect(result.transactions[0]).toMatchObject({
        direction: 'INCOMING',
        amount: { minorUnits: '9007199254740993' },
        balanceAfter: { minorUnits: '9007199254815993' },
      });
      expect(result.transactions[1]).toMatchObject({
        direction: 'OUTGOING',
        category: 'ADJUSTMENT',
        balanceAfter: { minorUnits: '75000' },
      });
    });

    it('filters direction, category and dates without changing balanceAfter', async () => {
      const all = await transactions.list(customerId, walletAccountId, {
        pageSize: 20,
      });
      const outgoing = await transactions.list(customerId, walletAccountId, {
        pageSize: 20,
        direction: 'OUTGOING',
        category: 'ADJUSTMENT',
      });
      expect(outgoing.transactions).toHaveLength(1);
      expect(outgoing.transactions[0]?.balanceAfter).toEqual(
        all.transactions.find(
          (item) => item.id === outgoing.transactions[0]?.id,
        )?.balanceAfter,
      );
      const dateFiltered = await transactions.list(
        customerId,
        walletAccountId,
        {
          pageSize: 20,
          dateFrom: '2026-01-01T00:00:00.000Z',
          dateTo: '2027-01-01T00:00:00.000Z',
        },
      );
      expect(dateFiltered.transactions.length).toBeGreaterThanOrEqual(3);
    });

    it('paginates without duplicates or skipped postings', async () => {
      await fundWallet('1', `fund-${runId}-page-a`);
      await fundWallet('1', `fund-${runId}-page-b`);
      const all = await transactions.list(customerId, walletAccountId, {
        pageSize: 20,
      });
      const first = await transactions.list(customerId, walletAccountId, {
        pageSize: 2,
      });
      const second = await transactions.list(customerId, walletAccountId, {
        pageSize: 2,
        cursor: first.nextCursor!,
      });
      const third = await transactions.list(customerId, walletAccountId, {
        pageSize: 2,
        cursor: second.nextCursor!,
      });
      const paged = [
        ...first.transactions,
        ...second.transactions,
        ...third.transactions,
      ];
      expect(paged.map((item) => item.id)).toEqual(
        all.transactions.map((item) => item.id),
      );
      expect(new Set(paged.map((item) => item.id)).size).toBe(paged.length);
      expect(third.nextCursor).toBeNull();
    });

    it('rejects malformed and filter-mismatched cursors', async () => {
      await expect(
        transactions.list(customerId, walletAccountId, {
          pageSize: 2,
          cursor: 'malformed',
        }),
      ).rejects.toThrow('Invalid transaction history cursor');
      const first = await transactions.list(customerId, walletAccountId, {
        pageSize: 2,
      });
      await expect(
        transactions.list(customerId, walletAccountId, {
          pageSize: 2,
          direction: 'OUTGOING',
          cursor: first.nextCursor!,
        }),
      ).rejects.toThrow('Invalid transaction history cursor');
    });

    it('enforces account and transaction ownership with the same 404', async () => {
      const owned = await transactions.list(customerId, walletAccountId, {
        pageSize: 20,
      });
      const transactionId = owned.transactions[0]!.id;
      await expect(
        transactions.list(randomUUID(), walletAccountId, { pageSize: 20 }),
      ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND', status: 404 });
      await expect(
        transactions.detail(randomUUID(), walletAccountId, transactionId),
      ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND', status: 404 });
      await expect(
        transactions.detail(customerId, walletAccountId, randomUUID()),
      ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND', status: 404 });
      await expect(
        transactions.detail(customerId, randomUUID(), transactionId),
      ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND', status: 404 });
    });

    it('returns a customer-safe transaction detail', async () => {
      const history = await transactions.list(customerId, walletAccountId, {
        pageSize: 20,
      });
      const detail = await transactions.detail(
        customerId,
        walletAccountId,
        history.transactions[0]!.id,
      );
      expect(detail.maskedAccountReference).toMatch(
        /^AEGIS-\*{4}-\*{4}-[A-Z0-9]{4}$/u,
      );
      for (const forbidden of [
        'ledgerAccountId',
        'reference',
        'metadata',
        'createdBy',
        'correlationId',
      ])
        expect(detail).not.toHaveProperty(forbidden);
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
