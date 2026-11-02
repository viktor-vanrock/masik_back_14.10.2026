-- CatalogEntry is the only owner of moderation and publication state.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "benchmark_tests" AS test
    LEFT JOIN "catalog_entries" AS entry ON entry."test_id" = test."id"
    WHERE entry."id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot remove benchmark_tests.validation_status: BenchmarkTest without CatalogEntry exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "benchmark_tests" AS test
    JOIN "catalog_entries" AS entry ON entry."test_id" = test."id"
    WHERE test."validation_status" IS NOT NULL
      AND test."validation_status" <> entry."status"
  ) THEN
    RAISE EXCEPTION
      'Cannot remove benchmark_tests.validation_status: it conflicts with CatalogEntry.status';
  END IF;
END $$;

ALTER TABLE "benchmark_tests" DROP COLUMN "validation_status";
