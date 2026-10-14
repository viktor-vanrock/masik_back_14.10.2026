ALTER TABLE "catalog_test_projections"
  ADD COLUMN "name" VARCHAR(500),
  ADD COLUMN "name_en" VARCHAR(500),
  ADD COLUMN "description" TEXT,
  ADD COLUMN "description_en" TEXT,
  ADD COLUMN "short_description" TEXT,
  ADD COLUMN "task_description" TEXT,
  ADD COLUMN "size_in_samples" INTEGER,
  ADD COLUMN "macro_group_id" UUID,
  ADD COLUMN "task_type_id" UUID,
  ADD COLUMN "language_id" UUID,
  ADD COLUMN "difficulty_id" UUID,
  ADD COLUMN "sub_group_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN "ability_taxon_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN "domain_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN "subdomain_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN "modality_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN "capability_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN "metric_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN "ability_tags" VARCHAR(255)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(255)[],
  ADD COLUMN "skills" VARCHAR(255)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(255)[],
  ADD COLUMN "source_created_at" TIMESTAMPTZ(6);

UPDATE "catalog_test_projections"
SET
  "name" = "snapshot" #>> '{specification,name}',
  "name_en" = "snapshot" #>> '{specification,nameEn}',
  "description" = "snapshot" #>> '{specification,description}',
  "description_en" = "snapshot" #>> '{specification,descriptionEn}',
  "short_description" = "snapshot" #>> '{specification,shortDescription}',
  "task_description" = "snapshot" #>> '{specification,taskDescription}',
  "size_in_samples" = ("snapshot" #>> '{specification,sizeInSamples}')::INTEGER,
  "macro_group_id" = NULLIF("snapshot" #>> '{specification,macroGroupId}', '')::UUID,
  "task_type_id" = NULLIF("snapshot" #>> '{specification,taskTypeId}', '')::UUID,
  "language_id" = NULLIF("snapshot" #>> '{specification,languageId}', '')::UUID,
  "difficulty_id" = NULLIF("snapshot" #>> '{specification,difficultyId}', '')::UUID,
  "sub_group_ids" = COALESCE(
    ARRAY(SELECT jsonb_array_elements_text("snapshot" #> '{specification,subGroupIds}'))::UUID[],
    ARRAY[]::UUID[]
  ),
  "ability_taxon_ids" = COALESCE(
    ARRAY(SELECT jsonb_array_elements_text("snapshot" #> '{specification,abilityTaxonIds}'))::UUID[],
    ARRAY[]::UUID[]
  ),
  "domain_ids" = COALESCE(
    ARRAY(SELECT jsonb_array_elements_text("snapshot" #> '{specification,domainIds}'))::UUID[],
    ARRAY[]::UUID[]
  ),
  "subdomain_ids" = COALESCE(
    ARRAY(SELECT jsonb_array_elements_text("snapshot" #> '{specification,subdomainIds}'))::UUID[],
    ARRAY[]::UUID[]
  ),
  "modality_ids" = COALESCE(
    ARRAY(SELECT jsonb_array_elements_text("snapshot" #> '{specification,modalityIds}'))::UUID[],
    ARRAY[]::UUID[]
  ),
  "capability_ids" = COALESCE(
    ARRAY(SELECT jsonb_array_elements_text("snapshot" #> '{specification,capabilityIds}'))::UUID[],
    ARRAY[]::UUID[]
  ),
  "metric_ids" = COALESCE(
    ARRAY(SELECT jsonb_array_elements_text("snapshot" #> '{specification,metricIds}'))::UUID[],
    ARRAY[]::UUID[]
  ),
  "ability_tags" = COALESCE(
    ARRAY(SELECT jsonb_array_elements_text("snapshot" #> '{specification,abilityTags}'))::VARCHAR(255)[],
    ARRAY[]::VARCHAR(255)[]
  ),
  "skills" = COALESCE(
    ARRAY(SELECT jsonb_array_elements_text("snapshot" #> '{specification,skills}'))::VARCHAR(255)[],
    ARRAY[]::VARCHAR(255)[]
  ),
  "source_created_at" = ("snapshot" #>> '{createdAt}')::TIMESTAMPTZ
WHERE "snapshot" IS NOT NULL;

CREATE INDEX "catalog_test_projections_deleted_at_source_created_at_test_id_idx"
  ON "catalog_test_projections" ("deleted_at", "source_created_at", "test_id");
CREATE INDEX "catalog_test_projections_name_idx"
  ON "catalog_test_projections" ("name");
CREATE INDEX "catalog_test_projections_macro_group_id_idx"
  ON "catalog_test_projections" ("macro_group_id");
CREATE INDEX "catalog_test_projections_task_type_id_idx"
  ON "catalog_test_projections" ("task_type_id");
CREATE INDEX "catalog_test_projections_language_id_idx"
  ON "catalog_test_projections" ("language_id");
CREATE INDEX "catalog_test_projections_difficulty_id_idx"
  ON "catalog_test_projections" ("difficulty_id");
CREATE INDEX "catalog_test_projections_size_in_samples_idx"
  ON "catalog_test_projections" ("size_in_samples");
CREATE INDEX "catalog_test_projections_sub_group_ids_gin_idx"
  ON "catalog_test_projections" USING GIN ("sub_group_ids");
CREATE INDEX "catalog_test_projections_ability_taxon_ids_gin_idx"
  ON "catalog_test_projections" USING GIN ("ability_taxon_ids");
CREATE INDEX "catalog_test_projections_domain_ids_gin_idx"
  ON "catalog_test_projections" USING GIN ("domain_ids");
CREATE INDEX "catalog_test_projections_subdomain_ids_gin_idx"
  ON "catalog_test_projections" USING GIN ("subdomain_ids");
CREATE INDEX "catalog_test_projections_modality_ids_gin_idx"
  ON "catalog_test_projections" USING GIN ("modality_ids");
CREATE INDEX "catalog_test_projections_capability_ids_gin_idx"
  ON "catalog_test_projections" USING GIN ("capability_ids");
CREATE INDEX "catalog_test_projections_ability_tags_gin_idx"
  ON "catalog_test_projections" USING GIN ("ability_tags");
CREATE INDEX "catalog_test_projections_skills_gin_idx"
  ON "catalog_test_projections" USING GIN ("skills");
