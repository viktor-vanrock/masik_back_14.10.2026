-- Benchmark/Test aggregates are now owned exclusively by benchmark-service.
-- Catalog keeps only its moderation state, external identifiers and Kafka projections.
DROP TABLE IF EXISTS "benchmark_examples";
DROP TABLE IF EXISTS "benchmark_references";
DROP TABLE IF EXISTS "benchmark_links";
DROP TABLE IF EXISTS "benchmark_test_metrics";
DROP TABLE IF EXISTS "benchmark_test_skills";
DROP TABLE IF EXISTS "benchmark_test_ability_taxons";
DROP TABLE IF EXISTS "benchmark_test_ability_tags";
DROP TABLE IF EXISTS "benchmark_test_sub_groups";
DROP TABLE IF EXISTS "benchmark_test_domains";
DROP TABLE IF EXISTS "benchmark_test_subdomains";
DROP TABLE IF EXISTS "benchmark_test_modalities";
DROP TABLE IF EXISTS "benchmark_test_capabilities";
DROP TABLE IF EXISTS "benchmark_test_project_groups";
DROP TABLE IF EXISTS "benchmark_test_feature_labels";
DROP TABLE IF EXISTS "dataset_subsamples";
DROP TABLE IF EXISTS "benchmark_tests";
DROP TABLE IF EXISTS "benchmarks";
DROP TYPE IF EXISTS "BenchmarkLinkType";
