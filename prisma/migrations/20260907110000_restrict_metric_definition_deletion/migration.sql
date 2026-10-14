-- Metric definitions are shared reference data. Deleting one must never erase
-- Test assignments or historical results through a cascading foreign key.
ALTER TABLE "benchmark_test_metrics"
DROP CONSTRAINT "benchmark_test_metrics_metric_id_fkey";

ALTER TABLE "benchmark_test_metrics"
ADD CONSTRAINT "benchmark_test_metrics_metric_id_fkey"
FOREIGN KEY ("metric_id") REFERENCES "metric_definitions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "metric_results"
DROP CONSTRAINT "metric_results_metric_id_fkey";

ALTER TABLE "metric_results"
ADD CONSTRAINT "metric_results_metric_id_fkey"
FOREIGN KEY ("metric_id") REFERENCES "metric_definitions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
