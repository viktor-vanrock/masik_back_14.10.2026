-- DatasetSubsample is the canonical name. It is metadata nested inside a Test,
-- not an independently classified dataset and not a MetricResult scope.

-- Refuse to erase legacy data silently. A failed guard means the historical
-- rows must be reviewed and reconciled with their parent Test before deploy.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "dataset_subsets" WHERE "task_type_id" IS NOT NULL) THEN
    RAISE EXCEPTION
      'Cannot canonicalize DatasetSubsample: dataset_subsets.task_type_id still contains data';
  END IF;

  IF EXISTS (SELECT 1 FROM "dataset_subset_domains") THEN
    RAISE EXCEPTION
      'Cannot canonicalize DatasetSubsample: dataset_subset_domains still contains data';
  END IF;

  IF EXISTS (SELECT 1 FROM "dataset_subset_subdomains") THEN
    RAISE EXCEPTION
      'Cannot canonicalize DatasetSubsample: dataset_subset_subdomains still contains data';
  END IF;

  IF EXISTS (SELECT 1 FROM "metric_results" WHERE "subset_id" IS NOT NULL) THEN
    RAISE EXCEPTION
      'Cannot remove subsample-scoped MetricResult storage: metric_results.subset_id still contains data';
  END IF;

  IF EXISTS (SELECT 1 FROM "metric_upload_rows" WHERE "subset_id" IS NOT NULL) THEN
    RAISE EXCEPTION
      'Cannot remove subsample-scoped MetricResult storage: metric_upload_rows.subset_id still contains data';
  END IF;
END $$;

DROP TABLE "dataset_subset_domains";
DROP TABLE "dataset_subset_subdomains";

ALTER TABLE "dataset_subsets"
  DROP CONSTRAINT "dataset_subsets_task_type_id_fkey",
  DROP COLUMN "task_type_id";

ALTER TABLE "metric_results"
  DROP CONSTRAINT "metric_results_subset_id_fkey",
  DROP COLUMN "subset_id";
ALTER TABLE "metric_results"
  RENAME COLUMN "raw_subset_name" TO "raw_subsample_name";

ALTER TABLE "metric_upload_rows"
  DROP CONSTRAINT "metric_upload_rows_subset_id_fkey",
  DROP COLUMN "subset_id";
ALTER TABLE "metric_upload_rows"
  RENAME COLUMN "raw_subset_name" TO "raw_subsample_name";

CREATE INDEX "metric_upload_rows_lookup_idx"
  ON "metric_upload_rows"(
    "model_id",
    "benchmark_id",
    "test_id",
    "metric_id",
    "obtained_at"
  );

ALTER TABLE "dataset_subsets" RENAME TO "dataset_subsamples";
ALTER TABLE "dataset_subsamples"
  RENAME CONSTRAINT "dataset_subsets_pkey" TO "dataset_subsamples_pkey";
ALTER TABLE "dataset_subsamples"
  RENAME CONSTRAINT "dataset_subsets_test_id_fkey" TO "dataset_subsamples_test_id_fkey";
ALTER INDEX "dataset_subsets_test_id_idx" RENAME TO "dataset_subsamples_test_id_idx";

ALTER TABLE "benchmark_examples" RENAME COLUMN "subset_id" TO "subsample_id";
ALTER TABLE "benchmark_examples"
  RENAME CONSTRAINT "benchmark_examples_subset_id_fkey" TO "benchmark_examples_subsample_id_fkey";
ALTER INDEX "benchmark_examples_subset_id_idx" RENAME TO "benchmark_examples_subsample_id_idx";
