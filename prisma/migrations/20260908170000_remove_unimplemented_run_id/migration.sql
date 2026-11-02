-- Run is not part of the current domain. Preserve any historical opaque ids
-- as migration provenance before removing the misleading pseudo-relation.
UPDATE "metric_results"
SET "metadata" = "metadata" || jsonb_build_object(
  '_removedRunId20260908', "run_id"::TEXT
)
WHERE "run_id" IS NOT NULL;

UPDATE "metric_upload_rows"
SET "raw_payload" = "raw_payload" || jsonb_build_object(
  '_removedRunId20260908', "run_id"::TEXT
)
WHERE "run_id" IS NOT NULL;

DROP INDEX IF EXISTS "metric_results_run_id_idx";

ALTER TABLE "metric_results" DROP COLUMN "run_id";
ALTER TABLE "metric_upload_rows" DROP COLUMN "run_id";
