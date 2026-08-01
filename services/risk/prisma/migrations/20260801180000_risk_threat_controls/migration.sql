-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "app";

-- CreateEnum
CREATE TYPE "RiskSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RiskBand" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RiskDecision" AS ENUM ('ALLOW', 'ALLOW_WITH_MONITORING', 'REQUIRE_STEP_UP', 'HOLD_FOR_REVIEW', 'BLOCK', 'QUARANTINE');

-- CreateEnum
CREATE TYPE "ControlStatus" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'FALSE_POSITIVE');

-- CreateTable
CREATE TABLE "security_events" (
    "id" UUID NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "source_event_id" VARCHAR(128) NOT NULL,
    "schema_version" VARCHAR(16) NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "severity" "RiskSeverity" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subject_id" VARCHAR(128),
    "account_id" VARCHAR(128),
    "session_id" VARCHAR(128),
    "device_id" VARCHAR(128),
    "recipient_id" VARCHAR(128),
    "correlation_id" UUID NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_set_versions" (
    "id" UUID NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "configuration" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_set_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_rules" (
    "id" UUID NOT NULL,
    "rule_set_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "weight" INTEGER NOT NULL,
    "configuration" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "risk_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_assessments" (
    "id" UUID NOT NULL,
    "evaluation_id" UUID NOT NULL,
    "event_id" UUID,
    "subject_id" VARCHAR(128) NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "score" INTEGER NOT NULL,
    "band" "RiskBand" NOT NULL,
    "decision" "RiskDecision" NOT NULL,
    "triggered_rules" TEXT[],
    "reason_codes" TEXT[],
    "control_recommendation" VARCHAR(32),
    "input_facts" JSONB NOT NULL,
    "rule_set_version" VARCHAR(32) NOT NULL,
    "public_explanation" VARCHAR(256) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_actions" (
    "id" UUID NOT NULL,
    "idempotency_key_hash" CHAR(64) NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "scope_type" VARCHAR(32) NOT NULL,
    "scope_id" VARCHAR(128) NOT NULL,
    "operation" VARCHAR(64),
    "reason_code" VARCHAR(64) NOT NULL,
    "status" "ControlStatus" NOT NULL DEFAULT 'ACTIVE',
    "assessment_id" UUID,
    "incident_id" UUID,
    "created_by" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "control_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_events" (
    "id" UUID NOT NULL,
    "control_id" UUID NOT NULL,
    "event_type" VARCHAR(32) NOT NULL,
    "actor_id" VARCHAR(128) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "control_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "assessment_id" UUID,
    "severity" "RiskSeverity" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "title" VARCHAR(160) NOT NULL,
    "assigned_to" VARCHAR(128),
    "resolution_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_events" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "event_type" VARCHAR(32) NOT NULL,
    "actor_id" VARCHAR(128) NOT NULL,
    "note" VARCHAR(1000),
    "evidence_ref" VARCHAR(256),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_health" (
    "source" VARCHAR(32) NOT NULL,
    "last_event_id" UUID NOT NULL,
    "last_occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "last_received_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_count" BIGINT NOT NULL DEFAULT 0,
    "duplicate_count" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "source_health_pkey" PRIMARY KEY ("source")
);

-- CreateTable
CREATE TABLE "operator_audits" (
    "id" UUID NOT NULL,
    "operator_id" VARCHAR(128) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(32) NOT NULL,
    "target_id" VARCHAR(128) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "correlation_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operator_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "security_events_received_at_idx" ON "security_events"("received_at");

-- CreateIndex
CREATE INDEX "security_events_severity_occurred_at_idx" ON "security_events"("severity", "occurred_at");

-- CreateIndex
CREATE INDEX "security_events_subject_id_occurred_at_idx" ON "security_events"("subject_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "security_events_source_source_event_id_key" ON "security_events"("source", "source_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "rule_set_versions_version_key" ON "rule_set_versions"("version");

-- CreateIndex
CREATE UNIQUE INDEX "risk_rules_rule_set_id_code_key" ON "risk_rules"("rule_set_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "risk_assessments_evaluation_id_key" ON "risk_assessments"("evaluation_id");

-- CreateIndex
CREATE INDEX "risk_assessments_subject_id_created_at_idx" ON "risk_assessments"("subject_id", "created_at");

-- CreateIndex
CREATE INDEX "risk_assessments_band_created_at_idx" ON "risk_assessments"("band", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "control_actions_idempotency_key_hash_key" ON "control_actions"("idempotency_key_hash");

-- CreateIndex
CREATE INDEX "control_actions_scope_type_scope_id_status_expires_at_idx" ON "control_actions"("scope_type", "scope_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "control_actions_status_expires_at_idx" ON "control_actions"("status", "expires_at");

-- CreateIndex
CREATE INDEX "control_events_control_id_occurred_at_idx" ON "control_events"("control_id", "occurred_at");

-- CreateIndex
CREATE INDEX "incidents_status_severity_created_at_idx" ON "incidents"("status", "severity", "created_at");

-- CreateIndex
CREATE INDEX "incident_events_incident_id_occurred_at_idx" ON "incident_events"("incident_id", "occurred_at");

-- CreateIndex
CREATE INDEX "operator_audits_operator_id_occurred_at_idx" ON "operator_audits"("operator_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "risk_rules" ADD CONSTRAINT "risk_rules_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "rule_set_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "security_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_actions" ADD CONSTRAINT "control_actions_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "risk_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_actions" ADD CONSTRAINT "control_actions_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_events" ADD CONSTRAINT "control_events_control_id_fkey" FOREIGN KEY ("control_id") REFERENCES "control_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "risk_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Original security facts and assessments are immutable. Security events may
-- only be deleted by the bounded retention job when they are not linked.
CREATE FUNCTION reject_risk_fact_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'risk facts are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER security_events_no_update
  BEFORE UPDATE ON "security_events"
  FOR EACH ROW EXECUTE FUNCTION reject_risk_fact_update();

CREATE TRIGGER risk_assessments_append_only
  BEFORE UPDATE OR DELETE ON "risk_assessments"
  FOR EACH ROW EXECUTE FUNCTION reject_risk_fact_update();

CREATE TRIGGER rule_set_versions_append_only
  BEFORE UPDATE OR DELETE ON "rule_set_versions"
  FOR EACH ROW EXECUTE FUNCTION reject_risk_fact_update();

CREATE FUNCTION reject_risk_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'risk lifecycle history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER control_events_append_only
  BEFORE UPDATE OR DELETE ON "control_events"
  FOR EACH ROW EXECUTE FUNCTION reject_risk_history_mutation();

CREATE TRIGGER incident_events_append_only
  BEFORE UPDATE OR DELETE ON "incident_events"
  FOR EACH ROW EXECUTE FUNCTION reject_risk_history_mutation();

CREATE TRIGGER operator_audits_append_only
  BEFORE UPDATE OR DELETE ON "operator_audits"
  FOR EACH ROW EXECUTE FUNCTION reject_risk_history_mutation();

ALTER TABLE "risk_assessments"
  ADD CONSTRAINT "risk_assessments_score_range" CHECK ("score" BETWEEN 0 AND 100),
  ADD CONSTRAINT "risk_assessments_expiry_after_creation" CHECK ("expires_at" > "created_at");

ALTER TABLE "control_actions"
  ADD CONSTRAINT "control_actions_expiry_after_creation" CHECK ("expires_at" > "created_at");
