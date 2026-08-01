CREATE SCHEMA IF NOT EXISTS "app";

CREATE TYPE "app"."TransferStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED', 'REQUIRES_REVIEW');
CREATE TYPE "app"."TransferFailureCode" AS ENUM ('INSUFFICIENT_FUNDS', 'ACCOUNT_NOT_FOUND', 'ACCOUNT_NOT_ACTIVE', 'CURRENCY_MISMATCH', 'SELF_TRANSFER', 'LIMIT_EXCEEDED', 'INTENT_EXPIRED', 'AUTHORIZATION_FAILED', 'IDEMPOTENCY_CONFLICT', 'LEDGER_UNAVAILABLE', 'PROCESSING_TIMEOUT', 'INTERNAL_ERROR');
CREATE TYPE "app"."TransferEventType" AS ENUM ('INTENT_CREATED', 'AUTHORIZED', 'PROCESSING_STARTED', 'LEDGER_POSTED', 'COMPLETED', 'FAILED', 'RECOVERY_RETRY', 'REQUIRES_REVIEW');
CREATE TYPE "app"."ReconciliationStatus" AS ENUM ('PASS', 'FAIL');

CREATE TABLE "app"."transfer_intents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "token_hash" CHAR(64) NOT NULL, "sender_customer_id" UUID NOT NULL, "source_account_id" UUID NOT NULL, "recipient_public_reference" VARCHAR(24) NOT NULL, "source_masked_reference" VARCHAR(24) NOT NULL, "recipient_masked_reference" VARCHAR(24) NOT NULL, "recipient_customer_id" UUID NOT NULL, "recipient_account_id" UUID NOT NULL, "currency" CHAR(3) NOT NULL, "amount_minor" BIGINT NOT NULL, "source_balance_snapshot_minor" BIGINT NOT NULL, "expires_at" TIMESTAMPTZ(3) NOT NULL, "authorized_at" TIMESTAMPTZ(3), "consumed_at" TIMESTAMPTZ(3), "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transfer_intents_pkey" PRIMARY KEY ("id"), CONSTRAINT "transfer_intents_token_hash_key" UNIQUE ("token_hash")
);
CREATE TABLE "app"."transfers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "display_reference" VARCHAR(32) NOT NULL, "sender_customer_id" UUID NOT NULL, "recipient_customer_id" UUID NOT NULL, "sender_account_id" UUID NOT NULL, "recipient_account_id" UUID NOT NULL, "sender_masked_reference" VARCHAR(24) NOT NULL, "recipient_masked_reference" VARCHAR(24) NOT NULL, "recipient_public_reference" VARCHAR(24) NOT NULL, "currency" CHAR(3) NOT NULL, "amount_minor" BIGINT NOT NULL, "status" "app"."TransferStatus" NOT NULL, "failure_code" "app"."TransferFailureCode", "failure_message_code" VARCHAR(64), "ledger_journal_id" UUID, "sender_posting_id" UUID, "recipient_posting_id" UUID, "sender_balance_after_minor" BIGINT, "recipient_balance_after_minor" BIGINT, "idempotency_key_hash" CHAR(64) NOT NULL, "request_hash" CHAR(64) NOT NULL, "intent_id" UUID NOT NULL, "correlation_id" UUID NOT NULL, "attempt_count" INTEGER NOT NULL DEFAULT 0, "next_attempt_at" TIMESTAMPTZ(3), "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completed_at" TIMESTAMPTZ(3), "failed_at" TIMESTAMPTZ(3),
  CONSTRAINT "transfers_pkey" PRIMARY KEY ("id"), CONSTRAINT "transfers_display_reference_key" UNIQUE ("display_reference"), CONSTRAINT "transfers_ledger_journal_id_key" UNIQUE ("ledger_journal_id"), CONSTRAINT "transfers_intent_id_key" UNIQUE ("intent_id"), CONSTRAINT "transfers_sender_customer_id_idempotency_key_hash_key" UNIQUE ("sender_customer_id", "idempotency_key_hash"), CONSTRAINT "transfers_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "app"."transfer_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "app"."transfer_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "transfer_id" UUID NOT NULL, "event_type" "app"."TransferEventType" NOT NULL, "previous_status" "app"."TransferStatus", "next_status" "app"."TransferStatus", "safe_code" VARCHAR(64), "occurred_at" TIMESTAMPTZ(3) NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transfer_events_pkey" PRIMARY KEY ("id"), CONSTRAINT "transfer_events_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "app"."transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "app"."reconciliation_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "status" "app"."ReconciliationStatus" NOT NULL, "checked_transfers" INTEGER NOT NULL, "checked_intents" INTEGER NOT NULL, "issue_count" INTEGER NOT NULL, "issues" JSONB NOT NULL DEFAULT '[]', "started_at" TIMESTAMPTZ(3) NOT NULL, "completed_at" TIMESTAMPTZ(3) NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "transfer_intents_sender_customer_id_expires_at_idx" ON "app"."transfer_intents"("sender_customer_id", "expires_at");
CREATE INDEX "transfers_sender_customer_id_created_at_id_idx" ON "app"."transfers"("sender_customer_id", "created_at", "id");
CREATE INDEX "transfers_recipient_customer_id_created_at_id_idx" ON "app"."transfers"("recipient_customer_id", "created_at", "id");
CREATE INDEX "transfers_sender_customer_id_status_created_at_idx" ON "app"."transfers"("sender_customer_id", "status", "created_at");
CREATE INDEX "transfers_status_next_attempt_at_idx" ON "app"."transfers"("status", "next_attempt_at");
CREATE INDEX "transfer_events_transfer_id_occurred_at_idx" ON "app"."transfer_events"("transfer_id", "occurred_at");

CREATE OR REPLACE FUNCTION "app"."reject_transfer_event_mutation"() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'transfer events are immutable'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "transfer_events_no_update" BEFORE UPDATE ON "app"."transfer_events" FOR EACH ROW EXECUTE FUNCTION "app"."reject_transfer_event_mutation"();
CREATE TRIGGER "transfer_events_no_delete" BEFORE DELETE ON "app"."transfer_events" FOR EACH ROW EXECUTE FUNCTION "app"."reject_transfer_event_mutation"();
