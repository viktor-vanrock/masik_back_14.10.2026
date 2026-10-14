-- Before CatalogEntry existed, every non-deleted BenchmarkTest was returned by
-- the public catalog regardless of validation_status. Existing rows also have
-- no trustworthy author, so leaving them in validation would make the entire
-- legacy catalog disappear after the new publication filter is deployed.
--
-- Preserve that public baseline once. New submissions always have author_id
-- and continue to enter validation through the application service.
UPDATE "catalog_entries"
SET
    "status" = 'published'::"BenchmarkValidationStatus",
    "reviewed_at" = COALESCE("reviewed_at", "updated_at")
WHERE "author_id" IS NULL
  AND "status" = 'validation'::"BenchmarkValidationStatus";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "catalog_entries"
    WHERE "author_id" IS NULL
      AND "status" = 'validation'::"BenchmarkValidationStatus"
  ) THEN
    RAISE EXCEPTION
      'Legacy system-owned CatalogEntry remained in validation after publication backfill';
  END IF;
END $$;
