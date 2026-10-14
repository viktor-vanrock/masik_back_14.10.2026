-- Case-insensitive uniqueness enforcement for taxonomy dictionaries.
--
-- Prisma 7 cannot express functional indexes in schema.prisma, so they live
-- in this dedicated migration. The regular @@unique declarations in
-- prisma/models/catalog.prisma stay in place to give Prisma a typed
-- `findUnique` key for case-exact lookups; the functional indexes below are
-- a strict superset and additionally block case-insensitive duplicates.
--
-- Conflict surface: a unique-violation on these indexes from a Settings
-- create/update should be mapped to HTTP 409 Conflict at the handler level.

-- ── Root dictionaries (global uniqueness) ───────────────────────────────────

CREATE UNIQUE INDEX "taxonomy_macro_groups_name_ci_key"
  ON "taxonomy_macro_groups" (lower("name"));
CREATE UNIQUE INDEX "taxonomy_macro_groups_name_en_ci_key"
  ON "taxonomy_macro_groups" (lower("name_en"));

CREATE UNIQUE INDEX "taxonomy_ability_taxons_name_ci_key"
  ON "taxonomy_ability_taxons" (lower("name"));
CREATE UNIQUE INDEX "taxonomy_ability_taxons_name_en_ci_key"
  ON "taxonomy_ability_taxons" (lower("name_en"));

CREATE UNIQUE INDEX "taxonomy_task_types_name_ci_key"
  ON "taxonomy_task_types" (lower("name"));
CREATE UNIQUE INDEX "taxonomy_task_types_name_en_ci_key"
  ON "taxonomy_task_types" (lower("name_en"));

CREATE UNIQUE INDEX "taxonomy_modalities_name_ci_key"
  ON "taxonomy_modalities" (lower("name"));
CREATE UNIQUE INDEX "taxonomy_modalities_name_en_ci_key"
  ON "taxonomy_modalities" (lower("name_en"));

CREATE UNIQUE INDEX "taxonomy_languages_name_ci_key"
  ON "taxonomy_languages" (lower("name"));
CREATE UNIQUE INDEX "taxonomy_languages_name_en_ci_key"
  ON "taxonomy_languages" (lower("name_en"));

CREATE UNIQUE INDEX "taxonomy_difficulties_name_ci_key"
  ON "taxonomy_difficulties" (lower("name"));
CREATE UNIQUE INDEX "taxonomy_difficulties_name_en_ci_key"
  ON "taxonomy_difficulties" (lower("name_en"));

CREATE UNIQUE INDEX "taxonomy_capabilities_name_ci_key"
  ON "taxonomy_capabilities" (lower("name"));
CREATE UNIQUE INDEX "taxonomy_capabilities_name_en_ci_key"
  ON "taxonomy_capabilities" (lower("name_en"));

CREATE UNIQUE INDEX "taxonomy_domains_name_ci_key"
  ON "taxonomy_domains" (lower("name"));
CREATE UNIQUE INDEX "taxonomy_domains_name_en_ci_key"
  ON "taxonomy_domains" (lower("name_en"));

-- ── Child dictionaries (parent-scoped uniqueness) ───────────────────────────

CREATE UNIQUE INDEX "taxonomy_sub_groups_macro_group_id_name_ci_key"
  ON "taxonomy_sub_groups" ("macro_group_id", lower("name"));
CREATE UNIQUE INDEX "taxonomy_sub_groups_macro_group_id_name_en_ci_key"
  ON "taxonomy_sub_groups" ("macro_group_id", lower("name_en"));

CREATE UNIQUE INDEX "taxonomy_subdomains_domain_id_name_ci_key"
  ON "taxonomy_subdomains" ("domain_id", lower("name"));
CREATE UNIQUE INDEX "taxonomy_subdomains_domain_id_name_en_ci_key"
  ON "taxonomy_subdomains" ("domain_id", lower("name_en"));
