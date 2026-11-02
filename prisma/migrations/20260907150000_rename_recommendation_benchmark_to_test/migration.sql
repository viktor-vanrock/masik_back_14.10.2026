-- A recommendation targets a BenchmarkTest. The old name incorrectly implied
-- that it targeted a Benchmark suite. RENAME preserves all recommendation data.
ALTER TABLE "recommendations"
RENAME COLUMN "benchmark_id" TO "test_id";

ALTER INDEX IF EXISTS "recommendations_conversation_id_benchmark_id_key"
RENAME TO "recommendations_conversation_id_test_id_key";

ALTER TABLE "hypothesis_generations"
RENAME COLUMN "benchmark_id" TO "test_id";

-- RecommendationRequest snapshots are JSONB, so migrate historical payloads
-- together with the relational column. Preserve array order and empty arrays.
UPDATE "recommendation_requests"
SET "candidate_payload" = COALESCE(
  (
    SELECT jsonb_agg(
      CASE
        WHEN item ? 'benchmarkId'
          THEN (item - 'benchmarkId') || jsonb_build_object('testId', item -> 'benchmarkId')
        ELSE item
      END
      ORDER BY ordinal
    )
    FROM jsonb_array_elements("candidate_payload") WITH ORDINALITY AS payload(item, ordinal)
  ),
  '[]'::jsonb
)
WHERE jsonb_typeof("candidate_payload") = 'array';

UPDATE "recommendation_requests"
SET "result_payload" = COALESCE(
  (
    SELECT jsonb_agg(
      CASE
        WHEN item ? 'benchmarkId'
          THEN (item - 'benchmarkId') || jsonb_build_object('testId', item -> 'benchmarkId')
        ELSE item
      END
      ORDER BY ordinal
    )
    FROM jsonb_array_elements("result_payload") WITH ORDINALITY AS payload(item, ordinal)
  ),
  '[]'::jsonb
)
WHERE jsonb_typeof("result_payload") = 'array';

-- Agent result/hypotheses message options used the same misleading key.
UPDATE "messages"
SET "options" = ("options" - 'benchmarkId') ||
  jsonb_build_object('testId', "options" -> 'benchmarkId')
WHERE jsonb_typeof("options") = 'object'
  AND "options" ? 'benchmarkId';
