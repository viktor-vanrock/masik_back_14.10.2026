CREATE TABLE "catalog_benchmark_projections" (
  "benchmark_id" VARCHAR(160) NOT NULL,
  "aggregate_version" INTEGER NOT NULL,
  "name" VARCHAR(500),
  "name_en" VARCHAR(500),
  "description" TEXT,
  "description_en" TEXT,
  "deleted_at" TIMESTAMPTZ(6),
  "source_updated_at" TIMESTAMPTZ(6) NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "catalog_benchmark_projections_pkey" PRIMARY KEY ("benchmark_id"),
  CONSTRAINT "catalog_benchmark_projections_version_positive"
    CHECK ("aggregate_version" > 0)
);

CREATE TABLE "catalog_test_projections" (
  "test_id" VARCHAR(160) NOT NULL,
  "benchmark_id" VARCHAR(160),
  "aggregate_version" INTEGER NOT NULL,
  "snapshot" JSONB,
  "deleted_at" TIMESTAMPTZ(6),
  "source_updated_at" TIMESTAMPTZ(6) NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "catalog_test_projections_pkey" PRIMARY KEY ("test_id"),
  CONSTRAINT "catalog_test_projections_version_positive"
    CHECK ("aggregate_version" > 0)
);

CREATE INDEX "catalog_benchmark_projections_deleted_at_idx"
ON "catalog_benchmark_projections"("deleted_at");

CREATE INDEX "catalog_benchmark_projections_source_updated_at_idx"
ON "catalog_benchmark_projections"("source_updated_at");

CREATE INDEX "catalog_test_projections_benchmark_id_deleted_at_idx"
ON "catalog_test_projections"("benchmark_id", "deleted_at");

CREATE INDEX "catalog_test_projections_source_updated_at_idx"
ON "catalog_test_projections"("source_updated_at");
