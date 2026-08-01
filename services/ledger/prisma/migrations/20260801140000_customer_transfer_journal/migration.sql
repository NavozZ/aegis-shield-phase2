-- Customer-to-customer transfer journals remain immutable Ledger entries.
ALTER TYPE "app"."JournalEntryType" ADD VALUE IF NOT EXISTS 'CUSTOMER_TRANSFER';
