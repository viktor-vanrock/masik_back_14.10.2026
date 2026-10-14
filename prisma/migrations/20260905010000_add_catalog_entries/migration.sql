-- Catalog owns publication and moderation independently of the Test
-- specification. The legacy benchmark_tests.validation_status column is kept
-- temporarily for a data-safe transition and is no longer written by the API.
CREATE TABLE "catalog_entries" (
    "id" UUID NOT NULL,
    "test_id" VARCHAR(160) NOT NULL,
    "author_id" UUID,
    "status" "BenchmarkValidationStatus" NOT NULL DEFAULT 'validation',
    "rejection_reason" TEXT,
    "reviewed_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "catalog_entries_pkey" PRIMARY KEY ("id")
);

-- Existing records have no trustworthy author in the old schema. They are
-- migrated as system-owned entries; every new user submission has author_id.
INSERT INTO "catalog_entries" (
    "id",
    "test_id",
    "status",
    "submitted_at",
    "reviewed_at",
    "created_at",
    "updated_at"
)
SELECT
    md5('catalog-entry:' || "id")::uuid,
    "id",
    COALESCE("validation_status", 'validation'::"BenchmarkValidationStatus"),
    "created_at",
    CASE
        WHEN "validation_status" IN ('published', 'rejected') THEN "updated_at"
        ELSE NULL
    END,
    "created_at",
    "updated_at"
FROM "benchmark_tests";

CREATE UNIQUE INDEX "catalog_entries_test_id_key" ON "catalog_entries"("test_id");
CREATE INDEX "catalog_entries_status_archived_at_idx" ON "catalog_entries"("status", "archived_at");
CREATE INDEX "catalog_entries_author_id_status_idx" ON "catalog_entries"("author_id", "status");
CREATE INDEX "catalog_entries_reviewed_by_id_idx" ON "catalog_entries"("reviewed_by_id");

ALTER TABLE "catalog_entries"
    ADD CONSTRAINT "catalog_entries_test_id_fkey"
    FOREIGN KEY ("test_id") REFERENCES "benchmark_tests"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "catalog_entries"
    ADD CONSTRAINT "catalog_entries_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "catalog_entries"
    ADD CONSTRAINT "catalog_entries_reviewed_by_id_fkey"
    FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
