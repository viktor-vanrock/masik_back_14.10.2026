-- Search documents are a Catalog-owned, rebuildable projection cache. Their
-- lifecycle must not depend on a Benchmark Test row in another service.
ALTER TABLE "benchmark_search_documents"
  DROP CONSTRAINT IF EXISTS "benchmark_search_documents_benchmark_test_id_fkey";
