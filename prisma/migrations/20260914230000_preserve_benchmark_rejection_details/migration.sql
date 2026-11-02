ALTER TABLE "benchmark_command_outcomes"
  ADD COLUMN "status_code" INTEGER,
  ADD COLUMN "deleted_id" UUID;

ALTER TABLE "benchmark_command_outcomes"
  ADD CONSTRAINT "benchmark_command_outcomes_status_code_check"
  CHECK ("status_code" IS NULL OR "status_code" IN (400, 404, 409));
