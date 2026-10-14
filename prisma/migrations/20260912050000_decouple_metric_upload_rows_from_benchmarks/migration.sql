-- Upload staging belongs to the catalog metrics context. Resolved remote ids
-- must remain useful even when Benchmark/Test rows live in another database.
ALTER TABLE "metric_upload_rows"
  DROP CONSTRAINT IF EXISTS "metric_upload_rows_benchmark_id_fkey",
  DROP CONSTRAINT IF EXISTS "metric_upload_rows_test_id_fkey";
