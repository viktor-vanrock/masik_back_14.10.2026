-- Metric results and their history belong to Catalog. Benchmark/Test identity
-- is validated against the local Kafka projection, never by a cross-database FK.
ALTER TABLE "metric_results"
  DROP CONSTRAINT IF EXISTS "metric_results_benchmark_id_fkey",
  DROP CONSTRAINT IF EXISTS "metric_results_test_id_fkey";
