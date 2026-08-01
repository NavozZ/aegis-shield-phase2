-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JournalEntryType" ADD VALUE 'QR_PAYMENT';
ALTER TYPE "JournalEntryType" ADD VALUE 'AGENT_CASH_IN';
ALTER TYPE "JournalEntryType" ADD VALUE 'AGENT_CASH_OUT';

-- AlterEnum
ALTER TYPE "SystemAccountType" ADD VALUE 'AGENT_FLOAT';

-- DropIndex
DROP INDEX "journal_postings_ledger_account_id_created_at_idx";

-- AlterTable
ALTER TABLE "customer_accounts" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "idempotency_records" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "journal_entries" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "journal_postings" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ledger_accounts" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "reconciliation_runs" ALTER COLUMN "id" DROP DEFAULT;
