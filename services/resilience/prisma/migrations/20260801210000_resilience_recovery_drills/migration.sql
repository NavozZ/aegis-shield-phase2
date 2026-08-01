-- Operational-resilience metadata.
--
-- Evidence about recovery, never recovered data. No customer records, no
-- balances, no dump contents: backup files are referenced by opaque identifier
-- and checksum only.

CREATE TABLE "app"."backup_sets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "backup_set_id" VARCHAR(128) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "services" TEXT[] NOT NULL,
  "manifest_checksum" CHAR(64) NOT NULL,
  "encryption_algorithm" VARCHAR(32) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "backup_sets_pkey" PRIMARY KEY ("id"),
  -- A manifest checksum is a full SHA-256 in lower-case hex, so a truncated or
  -- upper-cased value cannot be stored and later compared unequal.
  CONSTRAINT "backup_sets_manifest_checksum_hex" CHECK ("manifest_checksum" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "backup_sets_size_non_negative" CHECK ("size_bytes" >= 0),
  CONSTRAINT "backup_sets_services_not_empty" CHECK (array_length("services", 1) >= 1),
  -- Only the algorithm this prototype implements. A future algorithm is a
  -- deliberate migration, not a value an inserting process can assert.
  CONSTRAINT "backup_sets_algorithm_supported" CHECK ("encryption_algorithm" = 'AES-256-GCM')
);
CREATE UNIQUE INDEX "backup_sets_backup_set_id_key" ON "app"."backup_sets"("backup_set_id");
CREATE INDEX "backup_sets_created_at_idx" ON "app"."backup_sets"("created_at" DESC);

CREATE TABLE "app"."recovery_drills" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "drill_id" VARCHAR(128) NOT NULL,
  "type" VARCHAR(32) NOT NULL,
  "state" VARCHAR(32) NOT NULL,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "completed_at" TIMESTAMPTZ(6),
  "requested_by" VARCHAR(128) NOT NULL,
  "backup_set_id" UUID,
  "measured_recovery_point_age_seconds" INTEGER,
  "measured_recovery_duration_ms" INTEGER,
  "failure_code" VARCHAR(64),
  "acknowledged_at" TIMESTAMPTZ(6),
  "acknowledged_by" VARCHAR(128),
  "acknowledgement_reason" VARCHAR(500),
  CONSTRAINT "recovery_drills_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recovery_drills_backup_set_fkey" FOREIGN KEY ("backup_set_id")
    REFERENCES "app"."backup_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "recovery_drills_type_valid" CHECK ("type" IN ('SCHEDULED', 'MANUAL', 'CI_AUTOMATED')),
  CONSTRAINT "recovery_drills_state_valid" CHECK ("state" IN (
    'PLANNED', 'RUNNING', 'BACKUP_CREATED', 'RESTORE_VERIFIED',
    'RECONCILIATION_PASSED', 'PASSED', 'FAILED', 'CLEANED_UP'
  )),
  -- Prototype measurements, never negative and never used as a guarantee.
  CONSTRAINT "recovery_drills_point_age_non_negative"
    CHECK ("measured_recovery_point_age_seconds" IS NULL OR "measured_recovery_point_age_seconds" >= 0),
  CONSTRAINT "recovery_drills_duration_non_negative"
    CHECK ("measured_recovery_duration_ms" IS NULL OR "measured_recovery_duration_ms" >= 0),
  -- A drill cannot finish before it started.
  CONSTRAINT "recovery_drills_completion_after_start"
    CHECK ("completed_at" IS NULL OR "completed_at" >= "started_at"),
  -- A failure code belongs only to a failed drill, so the console cannot show a
  -- passing drill carrying a failure reason.
  CONSTRAINT "recovery_drills_failure_code_only_when_failed"
    CHECK ("failure_code" IS NULL OR "state" = 'FAILED'),
  -- An acknowledgement always records who and why alongside when.
  CONSTRAINT "recovery_drills_acknowledgement_complete" CHECK (
    ("acknowledged_at" IS NULL AND "acknowledged_by" IS NULL AND "acknowledgement_reason" IS NULL)
    OR ("acknowledged_at" IS NOT NULL AND "acknowledged_by" IS NOT NULL AND "acknowledgement_reason" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "recovery_drills_drill_id_key" ON "app"."recovery_drills"("drill_id");
CREATE INDEX "recovery_drills_started_at_idx" ON "app"."recovery_drills"("started_at" DESC);
CREATE INDEX "recovery_drills_state_started_at_idx" ON "app"."recovery_drills"("state", "started_at" DESC);

CREATE TABLE "app"."drill_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id" VARCHAR(128) NOT NULL,
  "drill_row_id" UUID NOT NULL,
  "state" VARCHAR(32) NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "note" VARCHAR(500),
  CONSTRAINT "drill_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "drill_events_drill_fkey" FOREIGN KEY ("drill_row_id")
    REFERENCES "app"."recovery_drills"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "drill_events_state_valid" CHECK ("state" IN (
    'PLANNED', 'RUNNING', 'BACKUP_CREATED', 'RESTORE_VERIFIED',
    'RECONCILIATION_PASSED', 'PASSED', 'FAILED', 'CLEANED_UP'
  ))
);
CREATE UNIQUE INDEX "drill_events_event_id_key" ON "app"."drill_events"("event_id");
CREATE INDEX "drill_events_drill_occurred_idx" ON "app"."drill_events"("drill_row_id", "occurred_at");

CREATE TABLE "app"."drill_reconciliations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "drill_row_id" UUID NOT NULL,
  "service" VARCHAR(32) NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "issue_count" INTEGER NOT NULL,
  "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "drill_reconciliations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "drill_reconciliations_drill_fkey" FOREIGN KEY ("drill_row_id")
    REFERENCES "app"."recovery_drills"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "drill_reconciliations_service_valid" CHECK ("service" IN (
    'identity', 'ledger', 'payments', 'risk', 'resilience'
  )),
  CONSTRAINT "drill_reconciliations_status_valid" CHECK ("status" IN ('PASS', 'FAIL')),
  CONSTRAINT "drill_reconciliations_issue_count_non_negative" CHECK ("issue_count" >= 0)
);
CREATE UNIQUE INDEX "drill_reconciliations_drill_service_key"
  ON "app"."drill_reconciliations"("drill_row_id", "service");
CREATE INDEX "drill_reconciliations_drill_idx" ON "app"."drill_reconciliations"("drill_row_id");

-- Append-only history.
--
-- Drill evidence is what an operator relies on after an incident, so it must not
-- be quietly rewritten. The database enforces this rather than trusting every
-- future caller to be careful — the same approach the Ledger and Risk services
-- already take for their own immutable facts.
CREATE FUNCTION "app"."reject_resilience_history_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'resilience drill history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "drill_events_append_only"
  BEFORE UPDATE OR DELETE ON "app"."drill_events"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_resilience_history_mutation"();

CREATE TRIGGER "drill_reconciliations_append_only"
  BEFORE UPDATE OR DELETE ON "app"."drill_reconciliations"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_resilience_history_mutation"();

-- A backup set is a statement about bytes that already exist on disk. Changing
-- its checksum after the fact would invalidate every drill that referenced it.
CREATE FUNCTION "app"."reject_backup_set_mutation"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'backup set records are immutable';
  END IF;
  IF NEW."backup_set_id" IS DISTINCT FROM OLD."backup_set_id"
    OR NEW."manifest_checksum" IS DISTINCT FROM OLD."manifest_checksum"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR NEW."services" IS DISTINCT FROM OLD."services"
    OR NEW."size_bytes" IS DISTINCT FROM OLD."size_bytes" THEN
    RAISE EXCEPTION 'backup set identity and integrity fields are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- `verified` may still be set once a restore has proved the set is usable;
-- everything that identifies the bytes is frozen.
CREATE TRIGGER "backup_sets_immutable_identity"
  BEFORE UPDATE OR DELETE ON "app"."backup_sets"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_backup_set_mutation"();
