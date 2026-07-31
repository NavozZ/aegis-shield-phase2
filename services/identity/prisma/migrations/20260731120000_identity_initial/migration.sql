CREATE TYPE "app"."PreferredLanguage" AS ENUM ('EN', 'SI', 'TA');
CREATE TYPE "app"."UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'LOCKED', 'DISABLED');

CREATE TABLE "app"."users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone_e164" VARCHAR(16) NOT NULL,
    "preferred_language" "app"."PreferredLanguage" NOT NULL DEFAULT 'EN',
    "kyc_tier" INTEGER NOT NULL DEFAULT 0,
    "status" "app"."UserStatus" NOT NULL DEFAULT 'PENDING',
    "consent_accepted_at" TIMESTAMPTZ(3) NOT NULL,
    "phone_verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "last_authenticated_at" TIMESTAMPTZ(3),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app"."pin_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "algorithm" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "rotated_at" TIMESTAMPTZ(3),
    CONSTRAINT "pin_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app"."passkey_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "device_type" VARCHAR(32) NOT NULL,
    "backed_up" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    "nickname" VARCHAR(64),
    "revoked_at" TIMESTAMPTZ(3),
    CONSTRAINT "passkey_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app"."auth_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "event_type" VARCHAR(64) NOT NULL,
    "outcome" VARCHAR(32) NOT NULL,
    "correlation_id" UUID NOT NULL,
    "masked_actor" VARCHAR(64) NOT NULL,
    "ip_hash" CHAR(64),
    "user_agent_hash" CHAR(64),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_phone_e164_key" ON "app"."users"("phone_e164");
CREATE INDEX "users_status_locked_until_idx" ON "app"."users"("status", "locked_until");
CREATE UNIQUE INDEX "pin_credentials_user_id_key" ON "app"."pin_credentials"("user_id");
CREATE UNIQUE INDEX "passkey_credentials_credential_id_key" ON "app"."passkey_credentials"("credential_id");
CREATE INDEX "passkey_credentials_user_id_revoked_at_idx" ON "app"."passkey_credentials"("user_id", "revoked_at");
CREATE INDEX "auth_events_user_id_created_at_idx" ON "app"."auth_events"("user_id", "created_at");
CREATE INDEX "auth_events_event_type_created_at_idx" ON "app"."auth_events"("event_type", "created_at");
CREATE INDEX "auth_events_correlation_id_idx" ON "app"."auth_events"("correlation_id");

ALTER TABLE "app"."pin_credentials" ADD CONSTRAINT "pin_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app"."passkey_credentials" ADD CONSTRAINT "passkey_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app"."auth_events" ADD CONSTRAINT "auth_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
