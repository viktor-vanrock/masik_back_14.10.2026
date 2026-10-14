ALTER TABLE "benchmarks"
ADD COLUMN "aggregate_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "benchmarks"
ADD CONSTRAINT "benchmarks_aggregate_version_positive"
CHECK ("aggregate_version" > 0);
