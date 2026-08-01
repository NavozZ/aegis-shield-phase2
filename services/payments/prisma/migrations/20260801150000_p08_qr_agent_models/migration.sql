-- CreateEnum
CREATE TYPE "QrType" AS ENUM ('STATIC', 'DYNAMIC');

-- CreateEnum
CREATE TYPE "QrPaymentRequestStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QrPaymentStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "QrPaymentEventType" AS ENUM ('QR_ISSUED', 'QR_SCANNED', 'PAYMENT_PROCESSING', 'LEDGER_POSTED', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AgentCashOperationType" AS ENUM ('AGENT_CASH_IN', 'AGENT_CASH_OUT');

-- CreateEnum
CREATE TYPE "AgentCashOperationStatus" AS ENUM ('PENDING_CONFIRMATION', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgentCashEventType" AS ENUM ('OPERATION_CREATED', 'CUSTOMER_CONFIRMED', 'PROCESSING_STARTED', 'LEDGER_POSTED', 'COMPLETED', 'FAILED', 'CANCELLED', 'RECOVERY_RETRY');

-- AlterTable
ALTER TABLE "reconciliation_runs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "transfer_events" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "transfer_intents" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "transfers" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "qr_payment_requests" (
    "id" UUID NOT NULL,
    "type" "QrType" NOT NULL,
    "status" "QrPaymentRequestStatus" NOT NULL DEFAULT 'ACTIVE',
    "recipient_customer_id" UUID NOT NULL,
    "recipient_account_id" UUID NOT NULL,
    "recipient_masked_reference" VARCHAR(24) NOT NULL,
    "recipient_public_reference" VARCHAR(24) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT,
    "purpose" VARCHAR(64),
    "nonce_hash" CHAR(64) NOT NULL,
    "signature_hash" CHAR(64) NOT NULL,
    "protocol_version" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "redeemed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "qr_payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_redemptions" (
    "id" UUID NOT NULL,
    "qr_payment_request_id" UUID NOT NULL,
    "display_reference" VARCHAR(32) NOT NULL,
    "sender_customer_id" UUID NOT NULL,
    "sender_account_id" UUID NOT NULL,
    "sender_masked_reference" VARCHAR(24) NOT NULL,
    "recipient_customer_id" UUID NOT NULL,
    "recipient_account_id" UUID NOT NULL,
    "recipient_masked_reference" VARCHAR(24) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "status" "QrPaymentStatus" NOT NULL DEFAULT 'PROCESSING',
    "intent_token_hash" CHAR(64) NOT NULL,
    "idempotency_key_hash" CHAR(64) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "ledger_journal_id" UUID,
    "sender_balance_after_minor" BIGINT,
    "recipient_balance_after_minor" BIGINT,
    "correlation_id" UUID NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),

    CONSTRAINT "qr_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_payment_events" (
    "id" UUID NOT NULL,
    "qr_payment_request_id" UUID NOT NULL,
    "event_type" "QrPaymentEventType" NOT NULL,
    "previous_status" VARCHAR(32),
    "next_status" VARCHAR(32),
    "safe_code" VARCHAR(64),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_cash_operations" (
    "id" UUID NOT NULL,
    "display_reference" VARCHAR(32) NOT NULL,
    "operation_type" "AgentCashOperationType" NOT NULL,
    "status" "AgentCashOperationStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "agent_id" UUID NOT NULL,
    "agent_reference" VARCHAR(24) NOT NULL,
    "customer_customer_id" UUID NOT NULL,
    "customer_account_id" UUID NOT NULL,
    "customer_masked_reference" VARCHAR(24) NOT NULL,
    "customer_public_reference" VARCHAR(24) NOT NULL,
    "agent_account_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "intent_token_hash" CHAR(64) NOT NULL,
    "idempotency_key_hash" CHAR(64) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "ledger_journal_id" UUID,
    "correlation_id" UUID NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),

    CONSTRAINT "agent_cash_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_cash_events" (
    "id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "event_type" "AgentCashEventType" NOT NULL,
    "previous_status" "AgentCashOperationStatus",
    "next_status" "AgentCashOperationStatus",
    "safe_code" VARCHAR(64),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_cash_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qr_payment_requests_nonce_hash_key" ON "qr_payment_requests"("nonce_hash");

-- CreateIndex
CREATE INDEX "qr_payment_requests_recipient_customer_id_created_at_idx" ON "qr_payment_requests"("recipient_customer_id", "created_at");

-- CreateIndex
CREATE INDEX "qr_payment_requests_expires_at_status_idx" ON "qr_payment_requests"("expires_at", "status");

-- CreateIndex
CREATE UNIQUE INDEX "qr_redemptions_qr_payment_request_id_key" ON "qr_redemptions"("qr_payment_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "qr_redemptions_display_reference_key" ON "qr_redemptions"("display_reference");

-- CreateIndex
CREATE UNIQUE INDEX "qr_redemptions_intent_token_hash_key" ON "qr_redemptions"("intent_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "qr_redemptions_ledger_journal_id_key" ON "qr_redemptions"("ledger_journal_id");

-- CreateIndex
CREATE INDEX "qr_redemptions_sender_customer_id_created_at_idx" ON "qr_redemptions"("sender_customer_id", "created_at");

-- CreateIndex
CREATE INDEX "qr_redemptions_status_next_attempt_at_idx" ON "qr_redemptions"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "qr_redemptions_sender_customer_id_idempotency_key_hash_key" ON "qr_redemptions"("sender_customer_id", "idempotency_key_hash");

-- CreateIndex
CREATE INDEX "qr_payment_events_qr_payment_request_id_occurred_at_idx" ON "qr_payment_events"("qr_payment_request_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_cash_operations_display_reference_key" ON "agent_cash_operations"("display_reference");

-- CreateIndex
CREATE UNIQUE INDEX "agent_cash_operations_intent_token_hash_key" ON "agent_cash_operations"("intent_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "agent_cash_operations_ledger_journal_id_key" ON "agent_cash_operations"("ledger_journal_id");

-- CreateIndex
CREATE INDEX "agent_cash_operations_agent_id_created_at_idx" ON "agent_cash_operations"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_cash_operations_status_next_attempt_at_idx" ON "agent_cash_operations"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_cash_operations_agent_id_idempotency_key_hash_key" ON "agent_cash_operations"("agent_id", "idempotency_key_hash");

-- CreateIndex
CREATE INDEX "agent_cash_events_operation_id_occurred_at_idx" ON "agent_cash_events"("operation_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "qr_redemptions" ADD CONSTRAINT "qr_redemptions_qr_payment_request_id_fkey" FOREIGN KEY ("qr_payment_request_id") REFERENCES "qr_payment_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_payment_events" ADD CONSTRAINT "qr_payment_events_qr_payment_request_id_fkey" FOREIGN KEY ("qr_payment_request_id") REFERENCES "qr_payment_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_cash_events" ADD CONSTRAINT "agent_cash_events_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "agent_cash_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
