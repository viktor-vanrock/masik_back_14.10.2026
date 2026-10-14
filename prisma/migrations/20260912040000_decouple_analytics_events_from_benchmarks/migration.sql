-- Analytics belongs to the catalog service. Benchmark and Test identifiers are
-- event dimensions received from benchmark-service projections, so enforcing
-- references to the legacy monolith tables would couple both databases.
ALTER TABLE "analytics_events"
  DROP CONSTRAINT IF EXISTS "analytics_events_benchmark_id_fkey",
  DROP CONSTRAINT IF EXISTS "analytics_events_benchmark_test_id_fkey";
