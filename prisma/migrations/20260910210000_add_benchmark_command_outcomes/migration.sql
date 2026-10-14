CREATE TABLE "benchmark_command_outcomes" (
    "command_event_id" UUID NOT NULL,
    "response_event_id" UUID NOT NULL,
    "command_event_type" VARCHAR(255) NOT NULL,
    "aggregate_type" VARCHAR(120) NOT NULL,
    "aggregate_id" VARCHAR(255) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "reason_code" VARCHAR(255),
    "message" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "benchmark_command_outcomes_pkey" PRIMARY KEY ("command_event_id"),
    CONSTRAINT "benchmark_command_outcomes_status_check"
      CHECK ("status" IN ('applied', 'rejected')),
    CONSTRAINT "benchmark_command_outcomes_reason_check"
      CHECK (
        ("status" = 'applied' AND "reason_code" IS NULL AND "message" IS NULL)
        OR
        ("status" = 'rejected' AND "reason_code" IS NOT NULL AND "message" IS NOT NULL)
      )
);

CREATE UNIQUE INDEX "benchmark_command_outcomes_response_event_id_key"
  ON "benchmark_command_outcomes"("response_event_id");

CREATE INDEX "benchmark_command_outcomes_aggregate_type_aggregate_id_recorded_at_idx"
  ON "benchmark_command_outcomes"("aggregate_type", "aggregate_id", "recorded_at");

CREATE INDEX "benchmark_command_outcomes_status_recorded_at_idx"
  ON "benchmark_command_outcomes"("status", "recorded_at");
