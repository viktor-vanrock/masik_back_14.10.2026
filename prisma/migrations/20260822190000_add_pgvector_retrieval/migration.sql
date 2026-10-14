CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "benchmark_search_documents" (
    "benchmark_test_id" VARCHAR(160) NOT NULL,
    "document_text" TEXT NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "embedding" vector NOT NULL,
    "embedding_spec_id" VARCHAR(255) NOT NULL,
    "embedding_dimensions" INTEGER NOT NULL,
    "source_updated_at" TIMESTAMPTZ(6) NOT NULL,
    "embedded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "benchmark_search_documents_pkey" PRIMARY KEY ("benchmark_test_id"),
    CONSTRAINT "benchmark_search_documents_embedding_dimensions_check"
      CHECK ("embedding_dimensions" > 0),
    CONSTRAINT "benchmark_search_documents_benchmark_test_id_fkey"
      FOREIGN KEY ("benchmark_test_id") REFERENCES "benchmark_tests"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "benchmark_search_documents_embedding_spec_id_embedding_dimensions_idx"
  ON "benchmark_search_documents"("embedding_spec_id", "embedding_dimensions");

CREATE INDEX "benchmark_search_documents_source_updated_at_idx"
  ON "benchmark_search_documents"("source_updated_at");

ALTER TABLE "recommendation_requests"
  ADD COLUMN "candidate_payload" JSONB,
  ADD COLUMN "reranker_version" VARCHAR(500),
  ADD COLUMN "retrieval_duration_ms" INTEGER;
