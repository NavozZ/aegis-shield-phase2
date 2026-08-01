-- Supports deterministic chronological transaction-history balance reads.
-- Ledger rows remain immutable; this adds no customer transaction table.
CREATE INDEX "journal_postings_ledger_account_id_created_at_id_idx"
  ON "app"."journal_postings" ("ledger_account_id", "created_at", "id");
