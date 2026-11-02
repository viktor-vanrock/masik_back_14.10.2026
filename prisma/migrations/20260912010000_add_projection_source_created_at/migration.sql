ALTER TABLE "catalog_benchmark_projections"
  ADD COLUMN "source_created_at" TIMESTAMPTZ(6);

CREATE INDEX "catalog_benchmark_projections_deleted_at_source_created_at_benchmark_id_idx"
  ON "catalog_benchmark_projections"("deleted_at", "source_created_at", "benchmark_id");
