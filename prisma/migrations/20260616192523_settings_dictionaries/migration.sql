/*
  Warnings:

  - The primary key for the `benchmark_test_ability_taxons` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `taxon` on the `benchmark_test_ability_taxons` table. All the data in the column will be lost.
  - The primary key for the `benchmark_test_domains` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `domain` on the `benchmark_test_domains` table. All the data in the column will be lost.
  - The primary key for the `benchmark_test_modalities` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `direction` on the `benchmark_test_modalities` table. All the data in the column will be lost.
  - You are about to drop the column `modality` on the `benchmark_test_modalities` table. All the data in the column will be lost.
  - The primary key for the `benchmark_test_sub_groups` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `sub_group` on the `benchmark_test_sub_groups` table. All the data in the column will be lost.
  - The primary key for the `benchmark_test_subdomains` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `subdomain` on the `benchmark_test_subdomains` table. All the data in the column will be lost.
  - You are about to drop the column `difficulty` on the `benchmark_tests` table. All the data in the column will be lost.
  - You are about to drop the column `few_shot` on the `benchmark_tests` table. All the data in the column will be lost.
  - You are about to drop the column `language` on the `benchmark_tests` table. All the data in the column will be lost.
  - You are about to drop the column `long_context` on the `benchmark_tests` table. All the data in the column will be lost.
  - You are about to drop the column `macro_group` on the `benchmark_tests` table. All the data in the column will be lost.
  - You are about to drop the column `rag` on the `benchmark_tests` table. All the data in the column will be lost.
  - You are about to drop the column `reasoning` on the `benchmark_tests` table. All the data in the column will be lost.
  - You are about to drop the column `task_type` on the `benchmark_tests` table. All the data in the column will be lost.
  - You are about to drop the column `tools` on the `benchmark_tests` table. All the data in the column will be lost.
  - The primary key for the `dataset_subset_domains` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `domain` on the `dataset_subset_domains` table. All the data in the column will be lost.
  - The primary key for the `dataset_subset_subdomains` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `subdomain` on the `dataset_subset_subdomains` table. All the data in the column will be lost.
  - You are about to drop the column `task_type` on the `dataset_subsets` table. All the data in the column will be lost.
  - Added the required column `ability_taxon_id` to the `benchmark_test_ability_taxons` table without a default value. This is not possible if the table is not empty.
  - Added the required column `domain_id` to the `benchmark_test_domains` table without a default value. This is not possible if the table is not empty.
  - Added the required column `modality_id` to the `benchmark_test_modalities` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sub_group_id` to the `benchmark_test_sub_groups` table without a default value. This is not possible if the table is not empty.
  - Added the required column `subdomain_id` to the `benchmark_test_subdomains` table without a default value. This is not possible if the table is not empty.
  - Added the required column `domain_id` to the `dataset_subset_domains` table without a default value. This is not possible if the table is not empty.
  - Added the required column `subdomain_id` to the `dataset_subset_subdomains` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "benchmark_test_ability_taxons_taxon_idx";

-- DropIndex
DROP INDEX "benchmark_test_domains_domain_idx";

-- DropIndex
DROP INDEX "benchmark_test_modalities_modality_idx";

-- DropIndex
DROP INDEX "benchmark_test_sub_groups_sub_group_idx";

-- DropIndex
DROP INDEX "benchmark_test_subdomains_subdomain_idx";

-- DropIndex
DROP INDEX "benchmark_tests_difficulty_idx";

-- DropIndex
DROP INDEX "benchmark_tests_language_idx";

-- DropIndex
DROP INDEX "benchmark_tests_macro_group_idx";

-- DropIndex
DROP INDEX "benchmark_tests_task_type_idx";

-- AlterTable
ALTER TABLE "benchmark_test_ability_taxons" DROP CONSTRAINT "benchmark_test_ability_taxons_pkey",
DROP COLUMN "taxon",
ADD COLUMN     "ability_taxon_id" UUID NOT NULL,
ADD CONSTRAINT "benchmark_test_ability_taxons_pkey" PRIMARY KEY ("test_id", "ability_taxon_id");

-- AlterTable
ALTER TABLE "benchmark_test_domains" DROP CONSTRAINT "benchmark_test_domains_pkey",
DROP COLUMN "domain",
ADD COLUMN     "domain_id" UUID NOT NULL,
ADD CONSTRAINT "benchmark_test_domains_pkey" PRIMARY KEY ("test_id", "domain_id");

-- AlterTable
ALTER TABLE "benchmark_test_modalities" DROP CONSTRAINT "benchmark_test_modalities_pkey",
DROP COLUMN "direction",
DROP COLUMN "modality",
ADD COLUMN     "modality_id" UUID NOT NULL,
ADD CONSTRAINT "benchmark_test_modalities_pkey" PRIMARY KEY ("test_id", "modality_id");

-- AlterTable
ALTER TABLE "benchmark_test_sub_groups" DROP CONSTRAINT "benchmark_test_sub_groups_pkey",
DROP COLUMN "sub_group",
ADD COLUMN     "sub_group_id" UUID NOT NULL,
ADD CONSTRAINT "benchmark_test_sub_groups_pkey" PRIMARY KEY ("test_id", "sub_group_id");

-- AlterTable
ALTER TABLE "benchmark_test_subdomains" DROP CONSTRAINT "benchmark_test_subdomains_pkey",
DROP COLUMN "subdomain",
ADD COLUMN     "subdomain_id" UUID NOT NULL,
ADD CONSTRAINT "benchmark_test_subdomains_pkey" PRIMARY KEY ("test_id", "subdomain_id");

-- AlterTable
ALTER TABLE "benchmark_tests" DROP COLUMN "difficulty",
DROP COLUMN "few_shot",
DROP COLUMN "language",
DROP COLUMN "long_context",
DROP COLUMN "macro_group",
DROP COLUMN "rag",
DROP COLUMN "reasoning",
DROP COLUMN "task_type",
DROP COLUMN "tools",
ADD COLUMN     "difficulty_id" UUID,
ADD COLUMN     "language_id" UUID,
ADD COLUMN     "macro_group_id" UUID,
ADD COLUMN     "task_type_id" UUID;

-- AlterTable
ALTER TABLE "dataset_subset_domains" DROP CONSTRAINT "dataset_subset_domains_pkey",
DROP COLUMN "domain",
ADD COLUMN     "domain_id" UUID NOT NULL,
ADD CONSTRAINT "dataset_subset_domains_pkey" PRIMARY KEY ("subset_id", "domain_id");

-- AlterTable
ALTER TABLE "dataset_subset_subdomains" DROP CONSTRAINT "dataset_subset_subdomains_pkey",
DROP COLUMN "subdomain",
ADD COLUMN     "subdomain_id" UUID NOT NULL,
ADD CONSTRAINT "dataset_subset_subdomains_pkey" PRIMARY KEY ("subset_id", "subdomain_id");

-- AlterTable
ALTER TABLE "dataset_subsets" DROP COLUMN "task_type",
ADD COLUMN     "task_type_id" UUID;

-- DropEnum
DROP TYPE "BenchmarkDifficulty";

-- DropEnum
DROP TYPE "BenchmarkLanguage";

-- DropEnum
DROP TYPE "BenchmarkModality";

-- DropEnum
DROP TYPE "BenchmarkModalityDirection";

-- DropEnum
DROP TYPE "BenchmarkTaskType";

-- CreateTable
CREATE TABLE "taxonomy_macro_groups" (
    "id" UUID NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "description_en" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "taxonomy_macro_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxonomy_sub_groups" (
    "id" UUID NOT NULL,
    "macro_group_id" UUID NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "description_en" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "taxonomy_sub_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxonomy_ability_taxons" (
    "id" UUID NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "description_en" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "taxonomy_ability_taxons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxonomy_task_types" (
    "id" UUID NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "description_en" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "taxonomy_task_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxonomy_modalities" (
    "id" UUID NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "description_en" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "taxonomy_modalities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxonomy_languages" (
    "id" UUID NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "description_en" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "taxonomy_languages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxonomy_difficulties" (
    "id" UUID NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "description_en" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "taxonomy_difficulties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxonomy_capabilities" (
    "id" UUID NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "description_en" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "taxonomy_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxonomy_domains" (
    "id" UUID NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "description_en" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "taxonomy_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxonomy_subdomains" (
    "id" UUID NOT NULL,
    "domain_id" UUID NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "description_en" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "taxonomy_subdomains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_test_capabilities" (
    "test_id" VARCHAR(160) NOT NULL,
    "capability_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "benchmark_test_capabilities_pkey" PRIMARY KEY ("test_id","capability_id")
);

-- CreateIndex
CREATE INDEX "taxonomy_macro_groups_deleted_at_idx" ON "taxonomy_macro_groups"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_macro_groups_name_key" ON "taxonomy_macro_groups"("name");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_macro_groups_name_en_key" ON "taxonomy_macro_groups"("name_en");

-- CreateIndex
CREATE INDEX "taxonomy_sub_groups_macro_group_id_idx" ON "taxonomy_sub_groups"("macro_group_id");

-- CreateIndex
CREATE INDEX "taxonomy_sub_groups_deleted_at_idx" ON "taxonomy_sub_groups"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_sub_groups_macro_group_id_name_key" ON "taxonomy_sub_groups"("macro_group_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_sub_groups_macro_group_id_name_en_key" ON "taxonomy_sub_groups"("macro_group_id", "name_en");

-- CreateIndex
CREATE INDEX "taxonomy_ability_taxons_deleted_at_idx" ON "taxonomy_ability_taxons"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_ability_taxons_name_key" ON "taxonomy_ability_taxons"("name");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_ability_taxons_name_en_key" ON "taxonomy_ability_taxons"("name_en");

-- CreateIndex
CREATE INDEX "taxonomy_task_types_deleted_at_idx" ON "taxonomy_task_types"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_task_types_name_key" ON "taxonomy_task_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_task_types_name_en_key" ON "taxonomy_task_types"("name_en");

-- CreateIndex
CREATE INDEX "taxonomy_modalities_deleted_at_idx" ON "taxonomy_modalities"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_modalities_name_key" ON "taxonomy_modalities"("name");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_modalities_name_en_key" ON "taxonomy_modalities"("name_en");

-- CreateIndex
CREATE INDEX "taxonomy_languages_deleted_at_idx" ON "taxonomy_languages"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_languages_name_key" ON "taxonomy_languages"("name");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_languages_name_en_key" ON "taxonomy_languages"("name_en");

-- CreateIndex
CREATE INDEX "taxonomy_difficulties_deleted_at_idx" ON "taxonomy_difficulties"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_difficulties_name_key" ON "taxonomy_difficulties"("name");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_difficulties_name_en_key" ON "taxonomy_difficulties"("name_en");

-- CreateIndex
CREATE INDEX "taxonomy_capabilities_deleted_at_idx" ON "taxonomy_capabilities"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_capabilities_name_key" ON "taxonomy_capabilities"("name");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_capabilities_name_en_key" ON "taxonomy_capabilities"("name_en");

-- CreateIndex
CREATE INDEX "taxonomy_domains_deleted_at_idx" ON "taxonomy_domains"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_domains_name_key" ON "taxonomy_domains"("name");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_domains_name_en_key" ON "taxonomy_domains"("name_en");

-- CreateIndex
CREATE INDEX "taxonomy_subdomains_domain_id_idx" ON "taxonomy_subdomains"("domain_id");

-- CreateIndex
CREATE INDEX "taxonomy_subdomains_deleted_at_idx" ON "taxonomy_subdomains"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_subdomains_domain_id_name_key" ON "taxonomy_subdomains"("domain_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_subdomains_domain_id_name_en_key" ON "taxonomy_subdomains"("domain_id", "name_en");

-- CreateIndex
CREATE INDEX "benchmark_test_capabilities_capability_id_idx" ON "benchmark_test_capabilities"("capability_id");

-- CreateIndex
CREATE INDEX "benchmark_test_ability_taxons_ability_taxon_id_idx" ON "benchmark_test_ability_taxons"("ability_taxon_id");

-- CreateIndex
CREATE INDEX "benchmark_test_domains_domain_id_idx" ON "benchmark_test_domains"("domain_id");

-- CreateIndex
CREATE INDEX "benchmark_test_modalities_modality_id_idx" ON "benchmark_test_modalities"("modality_id");

-- CreateIndex
CREATE INDEX "benchmark_test_sub_groups_sub_group_id_idx" ON "benchmark_test_sub_groups"("sub_group_id");

-- CreateIndex
CREATE INDEX "benchmark_test_subdomains_subdomain_id_idx" ON "benchmark_test_subdomains"("subdomain_id");

-- CreateIndex
CREATE INDEX "benchmark_tests_macro_group_id_idx" ON "benchmark_tests"("macro_group_id");

-- CreateIndex
CREATE INDEX "benchmark_tests_task_type_id_idx" ON "benchmark_tests"("task_type_id");

-- CreateIndex
CREATE INDEX "benchmark_tests_language_id_idx" ON "benchmark_tests"("language_id");

-- CreateIndex
CREATE INDEX "benchmark_tests_difficulty_id_idx" ON "benchmark_tests"("difficulty_id");

-- CreateIndex
CREATE INDEX "dataset_subset_domains_domain_id_idx" ON "dataset_subset_domains"("domain_id");

-- CreateIndex
CREATE INDEX "dataset_subset_subdomains_subdomain_id_idx" ON "dataset_subset_subdomains"("subdomain_id");

-- CreateIndex
CREATE INDEX "dataset_subsets_task_type_id_idx" ON "dataset_subsets"("task_type_id");

-- AddForeignKey
ALTER TABLE "taxonomy_sub_groups" ADD CONSTRAINT "taxonomy_sub_groups_macro_group_id_fkey" FOREIGN KEY ("macro_group_id") REFERENCES "taxonomy_macro_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taxonomy_subdomains" ADD CONSTRAINT "taxonomy_subdomains_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "taxonomy_domains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_tests" ADD CONSTRAINT "benchmark_tests_macro_group_id_fkey" FOREIGN KEY ("macro_group_id") REFERENCES "taxonomy_macro_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_tests" ADD CONSTRAINT "benchmark_tests_task_type_id_fkey" FOREIGN KEY ("task_type_id") REFERENCES "taxonomy_task_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_tests" ADD CONSTRAINT "benchmark_tests_language_id_fkey" FOREIGN KEY ("language_id") REFERENCES "taxonomy_languages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_tests" ADD CONSTRAINT "benchmark_tests_difficulty_id_fkey" FOREIGN KEY ("difficulty_id") REFERENCES "taxonomy_difficulties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_test_ability_taxons" ADD CONSTRAINT "benchmark_test_ability_taxons_ability_taxon_id_fkey" FOREIGN KEY ("ability_taxon_id") REFERENCES "taxonomy_ability_taxons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_test_sub_groups" ADD CONSTRAINT "benchmark_test_sub_groups_sub_group_id_fkey" FOREIGN KEY ("sub_group_id") REFERENCES "taxonomy_sub_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_test_domains" ADD CONSTRAINT "benchmark_test_domains_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "taxonomy_domains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_test_subdomains" ADD CONSTRAINT "benchmark_test_subdomains_subdomain_id_fkey" FOREIGN KEY ("subdomain_id") REFERENCES "taxonomy_subdomains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_test_modalities" ADD CONSTRAINT "benchmark_test_modalities_modality_id_fkey" FOREIGN KEY ("modality_id") REFERENCES "taxonomy_modalities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_test_capabilities" ADD CONSTRAINT "benchmark_test_capabilities_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "benchmark_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_test_capabilities" ADD CONSTRAINT "benchmark_test_capabilities_capability_id_fkey" FOREIGN KEY ("capability_id") REFERENCES "taxonomy_capabilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_subsets" ADD CONSTRAINT "dataset_subsets_task_type_id_fkey" FOREIGN KEY ("task_type_id") REFERENCES "taxonomy_task_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_subset_domains" ADD CONSTRAINT "dataset_subset_domains_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "taxonomy_domains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_subset_subdomains" ADD CONSTRAINT "dataset_subset_subdomains_subdomain_id_fkey" FOREIGN KEY ("subdomain_id") REFERENCES "taxonomy_subdomains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
