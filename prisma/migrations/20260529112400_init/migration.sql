-- CreateEnum
CREATE TYPE "BenchmarkTaskType" AS ENUM ('BinaryClassification', 'MultipleChoice', 'OpenGeneration', 'ClosedGeneration');

-- CreateEnum
CREATE TYPE "BenchmarkModality" AS ENUM ('text', 'image', 'audio', 'multimodal', 'video');

-- CreateEnum
CREATE TYPE "BenchmarkModalityDirection" AS ENUM ('input', 'output');

-- CreateEnum
CREATE TYPE "BenchmarkLanguage" AS ENUM ('ru', 'en', 'multilingual');

-- CreateEnum
CREATE TYPE "BenchmarkDifficulty" AS ENUM ('primary', 'secondary', 'higher', 'expert');

-- CreateEnum
CREATE TYPE "BenchmarkValidationStatus" AS ENUM ('validation', 'published', 'rejected');

-- CreateEnum
CREATE TYPE "BenchmarkLinkType" AS ENUM ('obs', 'gitverse', 'github', 'docs', 'dataset', 'score_racoon', 'giga_metrics', 'other');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN', 'SUPERUSER');

-- CreateTable
CREATE TABLE "benchmarks" (
    "id" VARCHAR(160) NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "description_en" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "benchmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_tests" (
    "id" VARCHAR(160) NOT NULL,
    "benchmark_id" VARCHAR(160) NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500) NOT NULL,
    "slug" VARCHAR(200),
    "description" TEXT,
    "description_en" TEXT,
    "short_description" TEXT,
    "task_description" TEXT,
    "instructions" TEXT,
    "instructions_en" TEXT,
    "codebase_name" VARCHAR(255),
    "codebase_url" VARCHAR(2000),
    "macro_group" VARCHAR(255),
    "task_type" "BenchmarkTaskType",
    "language" "BenchmarkLanguage" DEFAULT 'ru',
    "difficulty" "BenchmarkDifficulty" DEFAULT 'higher',
    "confidence_score" DOUBLE PRECISION,
    "confidentiality_level" VARCHAR(120),
    "knowledge_level" VARCHAR(120),
    "importance" VARCHAR(120),
    "importance_comment" TEXT,
    "context_field_format" VARCHAR(255),
    "answer_field_format" VARCHAR(255),
    "evaluation_logic" TEXT,
    "human_baseline" DOUBLE PRECISION,
    "human_baseline_notes" TEXT,
    "recommended_metrics_description" TEXT,
    "required_gigachat_quality_level" VARCHAR(120),
    "size_in_samples" INTEGER,
    "median_sample_words" INTEGER,
    "request_len_min" INTEGER,
    "request_len_median" INTEGER,
    "request_len_max" INTEGER,
    "response_len_min" INTEGER,
    "response_len_median" INTEGER,
    "response_len_max" INTEGER,
    "few_shot" BOOLEAN NOT NULL DEFAULT false,
    "rag" BOOLEAN NOT NULL DEFAULT false,
    "tools" BOOLEAN NOT NULL DEFAULT false,
    "reasoning" BOOLEAN NOT NULL DEFAULT false,
    "long_context" BOOLEAN NOT NULL DEFAULT false,
    "is_difficulty_auto_calculated" BOOLEAN NOT NULL DEFAULT false,
    "difficulty_calculation_comment" TEXT,
    "giga_metrics_codebase_url" VARCHAR(2000),
    "giga_metrics_adapter_name" VARCHAR(255),
    "giga_metrics_set_url" VARCHAR(2000),
    "giga_metrics_launch_command" TEXT,
    "validation_status" "BenchmarkValidationStatus",
    "is_generated" BOOLEAN NOT NULL DEFAULT false,
    "jira_ticket_id" VARCHAR(255),
    "generated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "benchmark_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_test_skills" (
    "test_id" VARCHAR(160) NOT NULL,
    "skill" VARCHAR(255) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "benchmark_test_skills_pkey" PRIMARY KEY ("test_id","skill")
);

-- CreateTable
CREATE TABLE "benchmark_test_ability_taxons" (
    "test_id" VARCHAR(160) NOT NULL,
    "taxon" VARCHAR(255) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "benchmark_test_ability_taxons_pkey" PRIMARY KEY ("test_id","taxon")
);

-- CreateTable
CREATE TABLE "benchmark_test_ability_tags" (
    "test_id" VARCHAR(160) NOT NULL,
    "tag" VARCHAR(255) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "benchmark_test_ability_tags_pkey" PRIMARY KEY ("test_id","tag")
);

-- CreateTable
CREATE TABLE "benchmark_test_sub_groups" (
    "test_id" VARCHAR(160) NOT NULL,
    "sub_group" VARCHAR(255) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "benchmark_test_sub_groups_pkey" PRIMARY KEY ("test_id","sub_group")
);

-- CreateTable
CREATE TABLE "benchmark_test_domains" (
    "test_id" VARCHAR(160) NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "benchmark_test_domains_pkey" PRIMARY KEY ("test_id","domain")
);

-- CreateTable
CREATE TABLE "benchmark_test_subdomains" (
    "test_id" VARCHAR(160) NOT NULL,
    "subdomain" VARCHAR(255) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "benchmark_test_subdomains_pkey" PRIMARY KEY ("test_id","subdomain")
);

-- CreateTable
CREATE TABLE "benchmark_test_modalities" (
    "test_id" VARCHAR(160) NOT NULL,
    "modality" "BenchmarkModality" NOT NULL,
    "direction" "BenchmarkModalityDirection" NOT NULL DEFAULT 'input',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "benchmark_test_modalities_pkey" PRIMARY KEY ("test_id","modality","direction")
);

-- CreateTable
CREATE TABLE "benchmark_test_project_groups" (
    "test_id" VARCHAR(160) NOT NULL,
    "project_group" VARCHAR(255) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "benchmark_test_project_groups_pkey" PRIMARY KEY ("test_id","project_group")
);

-- CreateTable
CREATE TABLE "benchmark_test_feature_labels" (
    "test_id" VARCHAR(160) NOT NULL,
    "feature_label" VARCHAR(255) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "benchmark_test_feature_labels_pkey" PRIMARY KEY ("test_id","feature_label")
);

-- CreateTable
CREATE TABLE "dataset_subsets" (
    "id" VARCHAR(160) NOT NULL,
    "test_id" VARCHAR(160) NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500),
    "description" TEXT,
    "split" VARCHAR(120),
    "task_type" "BenchmarkTaskType",
    "size_in_samples" INTEGER,
    "median_sample_words" INTEGER,
    "request_len_min" INTEGER,
    "request_len_median" INTEGER,
    "request_len_max" INTEGER,
    "response_len_min" INTEGER,
    "response_len_median" INTEGER,
    "response_len_max" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dataset_subsets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset_subset_domains" (
    "subset_id" VARCHAR(160) NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dataset_subset_domains_pkey" PRIMARY KEY ("subset_id","domain")
);

-- CreateTable
CREATE TABLE "dataset_subset_subdomains" (
    "subset_id" VARCHAR(160) NOT NULL,
    "subdomain" VARCHAR(255) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dataset_subset_subdomains_pkey" PRIMARY KEY ("subset_id","subdomain")
);

-- CreateTable
CREATE TABLE "benchmark_examples" (
    "id" SERIAL NOT NULL,
    "test_id" VARCHAR(160) NOT NULL,
    "subset_id" VARCHAR(160),
    "input" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "explanation" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "benchmark_examples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_references" (
    "id" SERIAL NOT NULL,
    "test_id" VARCHAR(160) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "url" VARCHAR(2000) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "benchmark_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_links" (
    "id" SERIAL NOT NULL,
    "test_id" VARCHAR(160) NOT NULL,
    "type" "BenchmarkLinkType" NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "url" VARCHAR(2000) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "benchmark_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_priority_lookups" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "metric_priority_lookups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_direction_lookups" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "metric_direction_lookups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "models" (
    "id" VARCHAR(160) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "provider" VARCHAR(255),
    "is_open_source" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_definitions" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255),
    "priority_id" UUID NOT NULL,
    "direction_id" UUID NOT NULL,
    "min_value" DECIMAL(12,6),
    "max_value" DECIMAL(12,6),
    "target_value" DECIMAL(12,6),
    "evaluation_logic" TEXT,
    "required_gigachat_quality_level" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "metric_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_test_metrics" (
    "test_id" VARCHAR(160) NOT NULL,
    "metric_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "benchmark_test_metrics_pkey" PRIMARY KEY ("test_id","metric_id")
);

-- CreateTable
CREATE TABLE "metric_results" (
    "id" UUID NOT NULL,
    "run_id" UUID,
    "benchmark_id" VARCHAR(160) NOT NULL,
    "test_id" VARCHAR(160) NOT NULL,
    "subset_id" VARCHAR(160),
    "metric_id" UUID NOT NULL,
    "model_id" VARCHAR(160) NOT NULL,
    "value" DECIMAL(14,6) NOT NULL,
    "raw_value" VARCHAR(255),
    "obtained_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "import_source" VARCHAR(500),
    "raw_model_name" VARCHAR(500),
    "raw_benchmark_name" VARCHAR(500),
    "raw_test_name" VARCHAR(500),
    "raw_subset_name" VARCHAR(500),
    "raw_metric_name" VARCHAR(255),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "metric_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_upload_rows" (
    "id" UUID NOT NULL,
    "run_id" UUID,
    "model_id" VARCHAR(160),
    "raw_model_name" VARCHAR(500) NOT NULL,
    "benchmark_id" VARCHAR(160),
    "raw_benchmark_name" VARCHAR(500) NOT NULL,
    "test_id" VARCHAR(160),
    "raw_test_name" VARCHAR(500) NOT NULL,
    "subset_id" VARCHAR(160),
    "raw_subset_name" VARCHAR(500),
    "metric_id" UUID,
    "raw_metric_name" VARCHAR(255) NOT NULL,
    "metric_value" DECIMAL(14,6) NOT NULL,
    "raw_metric_value" VARCHAR(255),
    "obtained_at" TIMESTAMPTZ(6) NOT NULL,
    "metric_result_id" UUID,
    "import_batch_id" VARCHAR(255),
    "source_row_number" INTEGER,
    "import_source" VARCHAR(500),
    "raw_payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "metric_upload_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "benchmarks_deleted_at_idx" ON "benchmarks"("deleted_at");

-- CreateIndex
CREATE INDEX "benchmark_tests_benchmark_id_idx" ON "benchmark_tests"("benchmark_id");

-- CreateIndex
CREATE INDEX "benchmark_tests_macro_group_idx" ON "benchmark_tests"("macro_group");

-- CreateIndex
CREATE INDEX "benchmark_tests_task_type_idx" ON "benchmark_tests"("task_type");

-- CreateIndex
CREATE INDEX "benchmark_tests_language_idx" ON "benchmark_tests"("language");

-- CreateIndex
CREATE INDEX "benchmark_tests_difficulty_idx" ON "benchmark_tests"("difficulty");

-- CreateIndex
CREATE INDEX "benchmark_tests_deleted_at_idx" ON "benchmark_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "benchmark_test_skills_skill_idx" ON "benchmark_test_skills"("skill");

-- CreateIndex
CREATE INDEX "benchmark_test_ability_taxons_taxon_idx" ON "benchmark_test_ability_taxons"("taxon");

-- CreateIndex
CREATE INDEX "benchmark_test_ability_tags_tag_idx" ON "benchmark_test_ability_tags"("tag");

-- CreateIndex
CREATE INDEX "benchmark_test_sub_groups_sub_group_idx" ON "benchmark_test_sub_groups"("sub_group");

-- CreateIndex
CREATE INDEX "benchmark_test_domains_domain_idx" ON "benchmark_test_domains"("domain");

-- CreateIndex
CREATE INDEX "benchmark_test_subdomains_subdomain_idx" ON "benchmark_test_subdomains"("subdomain");

-- CreateIndex
CREATE INDEX "benchmark_test_modalities_modality_idx" ON "benchmark_test_modalities"("modality");

-- CreateIndex
CREATE INDEX "benchmark_test_project_groups_project_group_idx" ON "benchmark_test_project_groups"("project_group");

-- CreateIndex
CREATE INDEX "benchmark_test_feature_labels_feature_label_idx" ON "benchmark_test_feature_labels"("feature_label");

-- CreateIndex
CREATE INDEX "dataset_subsets_test_id_idx" ON "dataset_subsets"("test_id");

-- CreateIndex
CREATE INDEX "benchmark_examples_test_id_idx" ON "benchmark_examples"("test_id");

-- CreateIndex
CREATE INDEX "benchmark_examples_subset_id_idx" ON "benchmark_examples"("subset_id");

-- CreateIndex
CREATE INDEX "benchmark_references_test_id_idx" ON "benchmark_references"("test_id");

-- CreateIndex
CREATE INDEX "benchmark_links_test_id_idx" ON "benchmark_links"("test_id");

-- CreateIndex
CREATE INDEX "benchmark_links_type_idx" ON "benchmark_links"("type");

-- CreateIndex
CREATE UNIQUE INDEX "metric_priority_lookups_code_key" ON "metric_priority_lookups"("code");

-- CreateIndex
CREATE UNIQUE INDEX "metric_direction_lookups_code_key" ON "metric_direction_lookups"("code");

-- CreateIndex
CREATE INDEX "models_provider_idx" ON "models"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "metric_definitions_name_key" ON "metric_definitions"("name");

-- CreateIndex
CREATE INDEX "metric_definitions_priority_id_idx" ON "metric_definitions"("priority_id");

-- CreateIndex
CREATE INDEX "metric_definitions_direction_id_idx" ON "metric_definitions"("direction_id");

-- CreateIndex
CREATE INDEX "benchmark_test_metrics_metric_id_idx" ON "benchmark_test_metrics"("metric_id");

-- CreateIndex
CREATE INDEX "metric_results_benchmark_id_test_id_metric_id_model_id_obta_idx" ON "metric_results"("benchmark_id", "test_id", "metric_id", "model_id", "obtained_at");

-- CreateIndex
CREATE INDEX "metric_results_subset_id_idx" ON "metric_results"("subset_id");

-- CreateIndex
CREATE INDEX "metric_results_run_id_idx" ON "metric_results"("run_id");

-- CreateIndex
CREATE INDEX "metric_upload_rows_model_id_benchmark_id_test_id_subset_id__idx" ON "metric_upload_rows"("model_id", "benchmark_id", "test_id", "subset_id", "metric_id", "obtained_at");

-- CreateIndex
CREATE INDEX "metric_upload_rows_raw_model_name_raw_benchmark_name_raw_te_idx" ON "metric_upload_rows"("raw_model_name", "raw_benchmark_name", "raw_test_name", "raw_metric_name");

-- CreateIndex
CREATE INDEX "metric_upload_rows_import_batch_id_source_row_number_idx" ON "metric_upload_rows"("import_batch_id", "source_row_number");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- AddForeignKey
ALTER TABLE "benchmark_tests" ADD CONSTRAINT "benchmark_tests_benchmark_id_fkey" FOREIGN KEY ("benchmark_id") REFERENCES "benchmarks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_test_skills" ADD CONSTRAINT "benchmark_test_skills_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "benchmark_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_test_ability_taxons" ADD CONSTRAINT "benchmark_test_ability_taxons_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "benchmark_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_test_ability_tags" ADD CONSTRAINT "benchmark_test_ability_tags_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "benchmark_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_test_sub_groups" ADD CONSTRAINT "benchmark_test_sub_groups_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "benchmark_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_test_domains" ADD CONSTRAINT "benchmark_test_domains_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "benchmark_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_test_subdomains" ADD CONSTRAINT "benchmark_test_subdomains_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "benchmark_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_test_modalities" ADD CONSTRAINT "benchmark_test_modalities_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "benchmark_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_test_project_groups" ADD CONSTRAINT "benchmark_test_project_groups_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "benchmark_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_test_feature_labels" ADD CONSTRAINT "benchmark_test_feature_labels_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "benchmark_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_subsets" ADD CONSTRAINT "dataset_subsets_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "benchmark_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_subset_domains" ADD CONSTRAINT "dataset_subset_domains_subset_id_fkey" FOREIGN KEY ("subset_id") REFERENCES "dataset_subsets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_subset_subdomains" ADD CONSTRAINT "dataset_subset_subdomains_subset_id_fkey" FOREIGN KEY ("subset_id") REFERENCES "dataset_subsets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_examples" ADD CONSTRAINT "benchmark_examples_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "benchmark_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_examples" ADD CONSTRAINT "benchmark_examples_subset_id_fkey" FOREIGN KEY ("subset_id") REFERENCES "dataset_subsets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_references" ADD CONSTRAINT "benchmark_references_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "benchmark_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_links" ADD CONSTRAINT "benchmark_links_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "benchmark_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_definitions" ADD CONSTRAINT "metric_definitions_priority_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "metric_priority_lookups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_definitions" ADD CONSTRAINT "metric_definitions_direction_id_fkey" FOREIGN KEY ("direction_id") REFERENCES "metric_direction_lookups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_test_metrics" ADD CONSTRAINT "benchmark_test_metrics_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "benchmark_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_test_metrics" ADD CONSTRAINT "benchmark_test_metrics_metric_id_fkey" FOREIGN KEY ("metric_id") REFERENCES "metric_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_results" ADD CONSTRAINT "metric_results_benchmark_id_fkey" FOREIGN KEY ("benchmark_id") REFERENCES "benchmarks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_results" ADD CONSTRAINT "metric_results_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "benchmark_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_results" ADD CONSTRAINT "metric_results_subset_id_fkey" FOREIGN KEY ("subset_id") REFERENCES "dataset_subsets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_results" ADD CONSTRAINT "metric_results_metric_id_fkey" FOREIGN KEY ("metric_id") REFERENCES "metric_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_results" ADD CONSTRAINT "metric_results_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_upload_rows" ADD CONSTRAINT "metric_upload_rows_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_upload_rows" ADD CONSTRAINT "metric_upload_rows_benchmark_id_fkey" FOREIGN KEY ("benchmark_id") REFERENCES "benchmarks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_upload_rows" ADD CONSTRAINT "metric_upload_rows_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "benchmark_tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_upload_rows" ADD CONSTRAINT "metric_upload_rows_subset_id_fkey" FOREIGN KEY ("subset_id") REFERENCES "dataset_subsets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_upload_rows" ADD CONSTRAINT "metric_upload_rows_metric_id_fkey" FOREIGN KEY ("metric_id") REFERENCES "metric_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_upload_rows" ADD CONSTRAINT "metric_upload_rows_metric_result_id_fkey" FOREIGN KEY ("metric_result_id") REFERENCES "metric_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;
