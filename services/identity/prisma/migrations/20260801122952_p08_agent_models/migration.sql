-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- AlterTable
ALTER TABLE "auth_events" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "passkey_credentials" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pin_credentials" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "agents" (
    "id" UUID NOT NULL,
    "public_reference" VARCHAR(24) NOT NULL,
    "display_name" VARCHAR(128) NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "pin_hash" TEXT NOT NULL,
    "algorithm" VARCHAR(128) NOT NULL,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agents_public_reference_key" ON "agents"("public_reference");

-- CreateIndex
CREATE INDEX "agents_status_idx" ON "agents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_sessions_token_hash_key" ON "agent_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "agent_sessions_agent_id_expires_at_idx" ON "agent_sessions"("agent_id", "expires_at");

-- CreateIndex
CREATE INDEX "agent_sessions_expires_at_idx" ON "agent_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
