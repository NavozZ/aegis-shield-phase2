-- AEGIS Shield ledger: accounts, immutable double-entry journals and balance
-- projections. Integrity is enforced by the database, not only by application
-- code, so that a defect or a direct SQL session cannot corrupt the ledger.

CREATE TYPE "app"."AccountProductType" AS ENUM ('TIER0_WALLET');
CREATE TYPE "app"."AccountStatus" AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');
CREATE TYPE "app"."LedgerAccountClass" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
CREATE TYPE "app"."NormalBalance" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "app"."PostingDirection" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "app"."JournalEntryType" AS ENUM ('ACCOUNT_ADJUSTMENT', 'SETTLEMENT_FUNDING', 'INTERNAL_TEST');
CREATE TYPE "app"."JournalStatus" AS ENUM ('POSTED');
CREATE TYPE "app"."SystemAccountType" AS ENUM ('PLATFORM_SETTLEMENT_ASSET', 'CUSTOMER_FUNDS_LIABILITY_CONTROL');
CREATE TYPE "app"."ActorType" AS ENUM ('SERVICE', 'CUSTOMER', 'SYSTEM');
CREATE TYPE "app"."IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');
CREATE TYPE "app"."ReconciliationStatus" AS ENUM ('PASS', 'FAIL');

CREATE TABLE "app"."ledger_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "account_class" "app"."LedgerAccountClass" NOT NULL,
    "normal_balance" "app"."NormalBalance" NOT NULL,
    "system_account_type" "app"."SystemAccountType",
    "allow_negative_balance" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app"."customer_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "public_reference" VARCHAR(24) NOT NULL,
    "masked_reference" VARCHAR(24) NOT NULL,
    "product_type" "app"."AccountProductType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "app"."AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "ledger_account_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app"."journal_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" VARCHAR(64) NOT NULL,
    "entry_type" "app"."JournalEntryType" NOT NULL,
    "status" "app"."JournalStatus" NOT NULL DEFAULT 'POSTED',
    "currency" CHAR(3) NOT NULL,
    "description" VARCHAR(256),
    "idempotency_key_hash" CHAR(64),
    "correlation_id" UUID NOT NULL,
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_type" "app"."ActorType" NOT NULL,
    "created_by_id" VARCHAR(64) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app"."journal_postings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "journal_entry_id" UUID NOT NULL,
    "ledger_account_id" UUID NOT NULL,
    "direction" "app"."PostingDirection" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "journal_postings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app"."balance_projections" (
    "ledger_account_id" UUID NOT NULL,
    "debit_total_minor" BIGINT NOT NULL DEFAULT 0,
    "credit_total_minor" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "balance_projections_pkey" PRIMARY KEY ("ledger_account_id")
);

CREATE TABLE "app"."idempotency_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope" VARCHAR(64) NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" "app"."IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app"."reconciliation_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "app"."ReconciliationStatus" NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3) NOT NULL,
    "checked_journal_entries" INTEGER NOT NULL,
    "checked_postings" INTEGER NOT NULL,
    "checked_ledger_accounts" INTEGER NOT NULL,
    "checked_customer_accounts" INTEGER NOT NULL,
    "issue_count" INTEGER NOT NULL,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "correlation_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "app"."ledger_accounts"("code");
CREATE UNIQUE INDEX "ledger_accounts_system_account_type_key" ON "app"."ledger_accounts"("system_account_type");
CREATE INDEX "ledger_accounts_account_class_currency_idx" ON "app"."ledger_accounts"("account_class", "currency");
CREATE UNIQUE INDEX "customer_accounts_public_reference_key" ON "app"."customer_accounts"("public_reference");
CREATE UNIQUE INDEX "customer_accounts_ledger_account_id_key" ON "app"."customer_accounts"("ledger_account_id");
CREATE UNIQUE INDEX "customer_accounts_customer_id_product_type_currency_key" ON "app"."customer_accounts"("customer_id", "product_type", "currency");
CREATE INDEX "customer_accounts_customer_id_idx" ON "app"."customer_accounts"("customer_id");
CREATE UNIQUE INDEX "journal_entries_reference_key" ON "app"."journal_entries"("reference");
CREATE INDEX "journal_entries_created_at_idx" ON "app"."journal_entries"("created_at");
CREATE INDEX "journal_entries_correlation_id_idx" ON "app"."journal_entries"("correlation_id");
CREATE UNIQUE INDEX "journal_postings_journal_entry_id_sequence_key" ON "app"."journal_postings"("journal_entry_id", "sequence");
CREATE INDEX "journal_postings_ledger_account_id_created_at_idx" ON "app"."journal_postings"("ledger_account_id", "created_at");
CREATE UNIQUE INDEX "idempotency_records_scope_key_hash_key" ON "app"."idempotency_records"("scope", "key_hash");
CREATE INDEX "idempotency_records_expires_at_idx" ON "app"."idempotency_records"("expires_at");
CREATE INDEX "reconciliation_runs_created_at_idx" ON "app"."reconciliation_runs"("created_at");

ALTER TABLE "app"."customer_accounts" ADD CONSTRAINT "customer_accounts_ledger_account_id_fkey" FOREIGN KEY ("ledger_account_id") REFERENCES "app"."ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app"."journal_postings" ADD CONSTRAINT "journal_postings_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "app"."journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app"."journal_postings" ADD CONSTRAINT "journal_postings_ledger_account_id_fkey" FOREIGN KEY ("ledger_account_id") REFERENCES "app"."ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app"."balance_projections" ADD CONSTRAINT "balance_projections_ledger_account_id_fkey" FOREIGN KEY ("ledger_account_id") REFERENCES "app"."ledger_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Value-level guarantees
-- ---------------------------------------------------------------------------

-- Money is stored as integer minor units. A posting amount is always strictly
-- positive; the direction column carries the sign.
ALTER TABLE "app"."journal_postings" ADD CONSTRAINT "journal_postings_amount_minor_positive" CHECK ("amount_minor" > 0);
ALTER TABLE "app"."journal_postings" ADD CONSTRAINT "journal_postings_sequence_range" CHECK ("sequence" >= 0 AND "sequence" < 32);
ALTER TABLE "app"."journal_postings" ADD CONSTRAINT "journal_postings_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "app"."journal_entries" ADD CONSTRAINT "journal_entries_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "app"."ledger_accounts" ADD CONSTRAINT "ledger_accounts_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "app"."customer_accounts" ADD CONSTRAINT "customer_accounts_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "app"."customer_accounts" ADD CONSTRAINT "customer_accounts_public_reference_format" CHECK ("public_reference" ~ '^AEGIS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$');
ALTER TABLE "app"."customer_accounts" ADD CONSTRAINT "customer_accounts_masked_reference_format" CHECK ("masked_reference" ~ '^AEGIS-\*{4}-\*{4}-[A-Z0-9]{4}$');
ALTER TABLE "app"."balance_projections" ADD CONSTRAINT "balance_projections_totals_non_negative" CHECK ("debit_total_minor" >= 0 AND "credit_total_minor" >= 0);
ALTER TABLE "app"."balance_projections" ADD CONSTRAINT "balance_projections_version_non_negative" CHECK ("version" >= 0);

-- An account class always has the matching normal balance. Customer wallets are
-- liabilities: a CREDIT increases the amount the platform owes the customer.
ALTER TABLE "app"."ledger_accounts" ADD CONSTRAINT "ledger_accounts_normal_balance_matches_class" CHECK (
  ("account_class" IN ('ASSET', 'EXPENSE') AND "normal_balance" = 'DEBIT')
  OR ("account_class" IN ('LIABILITY', 'EQUITY', 'REVENUE') AND "normal_balance" = 'CREDIT')
);

-- ---------------------------------------------------------------------------
-- Append-only protection for posted financial records
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "app"."reject_financial_mutation"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AEGIS_LEDGER_APPEND_ONLY_VIOLATION: % on %.% is not permitted', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "journal_entries_append_only"
BEFORE UPDATE OR DELETE ON "app"."journal_entries"
FOR EACH ROW EXECUTE FUNCTION "app"."reject_financial_mutation"();

CREATE TRIGGER "journal_postings_append_only"
BEFORE UPDATE OR DELETE ON "app"."journal_postings"
FOR EACH ROW EXECUTE FUNCTION "app"."reject_financial_mutation"();

-- ---------------------------------------------------------------------------
-- Deferred double-entry validation
--
-- Postings are inserted after their journal entry, so the balance rule can only
-- be evaluated once the whole transaction is complete. These constraint
-- triggers run at COMMIT and reject a committed journal that is unbalanced,
-- mixes currencies or carries fewer than two postings. The application performs
-- the same checks first; this is the authoritative backstop.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "app"."assert_journal_integrity"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_entry_id UUID;
  entry_currency CHAR(3);
  posting_count INTEGER;
  debit_total NUMERIC;
  credit_total NUMERIC;
  journal_currency_mismatches INTEGER;
  account_currency_mismatches INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    target_entry_id := NEW.id;
  ELSE
    target_entry_id := NEW.journal_entry_id;
  END IF;

  SELECT "currency" INTO entry_currency
  FROM "app"."journal_entries"
  WHERE "id" = target_entry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AEGIS_LEDGER_JOURNAL_MISSING: journal entry % does not exist', target_entry_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(CASE WHEN "direction" = 'DEBIT' THEN "amount_minor" ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount_minor" ELSE 0 END), 0),
    COUNT(*) FILTER (WHERE "currency" <> entry_currency)
  INTO posting_count, debit_total, credit_total, journal_currency_mismatches
  FROM "app"."journal_postings"
  WHERE "journal_entry_id" = target_entry_id;

  IF posting_count < 2 THEN
    RAISE EXCEPTION 'AEGIS_LEDGER_TOO_FEW_POSTINGS: journal entry % has % posting(s)', target_entry_id, posting_count
      USING ERRCODE = 'check_violation';
  END IF;

  IF journal_currency_mismatches > 0 THEN
    RAISE EXCEPTION 'AEGIS_LEDGER_JOURNAL_CURRENCY_MISMATCH: journal entry % mixes currencies', target_entry_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*) INTO account_currency_mismatches
  FROM "app"."journal_postings" AS posting
  JOIN "app"."ledger_accounts" AS account ON account."id" = posting."ledger_account_id"
  WHERE posting."journal_entry_id" = target_entry_id
    AND account."currency" <> posting."currency";

  IF account_currency_mismatches > 0 THEN
    RAISE EXCEPTION 'AEGIS_LEDGER_ACCOUNT_CURRENCY_MISMATCH: journal entry % posts to a foreign-currency account', target_entry_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF debit_total <> credit_total THEN
    RAISE EXCEPTION 'AEGIS_LEDGER_UNBALANCED_JOURNAL: journal entry % has debits % and credits %', target_entry_id, debit_total, credit_total
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "journal_entries_integrity_check"
AFTER INSERT ON "app"."journal_entries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "app"."assert_journal_integrity"();

CREATE CONSTRAINT TRIGGER "journal_postings_integrity_check"
AFTER INSERT ON "app"."journal_postings"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "app"."assert_journal_integrity"();

-- ---------------------------------------------------------------------------
-- Every ledger account owns exactly one balance projection from creation, so a
-- projection can never be missing for an account that receives postings.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "app"."bootstrap_balance_projection"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "app"."balance_projections" ("ledger_account_id", "debit_total_minor", "credit_total_minor", "version", "updated_at")
  VALUES (NEW."id", 0, 0, 0, CURRENT_TIMESTAMP)
  ON CONFLICT ("ledger_account_id") DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ledger_accounts_bootstrap_projection"
AFTER INSERT ON "app"."ledger_accounts"
FOR EACH ROW EXECUTE FUNCTION "app"."bootstrap_balance_projection"();

-- ---------------------------------------------------------------------------
-- Minimal system chart of accounts. Created idempotently and with no opening
-- balances: no journal entry is written and no funds are invented.
-- ---------------------------------------------------------------------------

INSERT INTO "app"."ledger_accounts" ("code", "name", "currency", "account_class", "normal_balance", "system_account_type", "allow_negative_balance")
VALUES
  ('SYS-PLATFORM-SETTLEMENT-LKR', 'Platform settlement (LKR)', 'LKR', 'ASSET', 'DEBIT', 'PLATFORM_SETTLEMENT_ASSET', true),
  ('SYS-CUSTOMER-FUNDS-CONTROL-LKR', 'Customer funds control (LKR)', 'LKR', 'LIABILITY', 'CREDIT', 'CUSTOMER_FUNDS_LIABILITY_CONTROL', true)
ON CONFLICT ("code") DO NOTHING;
