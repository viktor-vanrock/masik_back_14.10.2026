ALTER TABLE "benchmark_tests"
ADD COLUMN "aggregate_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "benchmark_tests"
ADD CONSTRAINT "benchmark_tests_aggregate_version_positive"
CHECK ("aggregate_version" > 0);
