-- MetricResult is canonical Test-level data. Preserve legacy source labels in
-- metadata before removing the field that suggested DatasetSubsample scope.
UPDATE "metric_results"
SET "metadata" = "metadata" || jsonb_build_object(
  '_removedRawSubsampleName20260908',
  "raw_subsample_name"
)
WHERE "raw_subsample_name" IS NOT NULL
  AND NOT ("metadata" ? '_removedRawSubsampleName20260908');

ALTER TABLE "metric_results" DROP COLUMN "raw_subsample_name";
