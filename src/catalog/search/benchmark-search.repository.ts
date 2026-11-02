import { Injectable } from '@nestjs/common';
import { BenchmarkTestReadScope } from '@/catalog/benchmark-test/benchmark-test-read-scope';
import { BenchmarkType } from '@/catalog/benchmark-test/types';
import { CatalogTestProjectionHydrator } from '@/catalog/projection/catalog-test-projection-hydrator.service';
import { BenchmarkValidationStatus, Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { publishedTestIds } from '../catalog-entry/catalog-entry.visibility';
import { executeSearchQuery } from './search-query.executor';
import { BenchmarkSearchSource, SearchDocumentRow, SearchDocumentUpsert } from './types';

export type SearchDocumentState = Readonly<{
  contentHash: string;
  embeddingSpecId: string;
  sourceUpdatedAt: Date;
}>;

export type LegacyInterviewerSearchRow = Readonly<{
  testId: string;
  document: string;
  score: number;
  datasetId: string | null;
  datasetDescription: string;
}>;

@Injectable()
export class BenchmarkSearchRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectionHydrator: CatalogTestProjectionHydrator
  ) {}

  async findSource(id: string): Promise<BenchmarkSearchSource | null> {
    const [source] = await this.findProjectionSources([id]);
    return source ?? null;
  }

  async findSources(ids: readonly string[]): Promise<BenchmarkSearchSource[]> {
    return this.findProjectionSources(ids);
  }

  async findPublishedIds(): Promise<string[]> {
    return this.findPublishedProjectionIds();
  }

  async findPublishedIdsBySuite(benchmarkId: string): Promise<string[]> {
    return this.findPublishedProjectionIds(benchmarkId);
  }

  async findProjectionIdsBySuite(benchmarkId: string): Promise<string[]> {
    const rows = await this.prisma.catalogTestProjection.findMany({
      where: { benchmarkId },
      select: { testId: true },
      orderBy: { testId: 'asc' },
    });
    return rows.map(({ testId }) => testId);
  }

  async findDocumentState(benchmarkTestId: string): Promise<SearchDocumentState | null> {
    return this.prisma.benchmarkSearchDocument.findUnique({
      where: { benchmarkTestId },
      select: {
        contentHash: true,
        embeddingSpecId: true,
        sourceUpdatedAt: true,
      },
    });
  }

  async touchDocumentSourceUpdatedAt(
    benchmarkTestId: string,
    sourceUpdatedAt: Date
  ): Promise<void> {
    await this.prisma.benchmarkSearchDocument.update({
      where: { benchmarkTestId },
      data: { sourceUpdatedAt },
    });
  }

  async upsertDocument(data: SearchDocumentUpsert): Promise<void> {
    const vector = this.vectorLiteral(data.embedding);

    await this.prisma.$executeRaw`
      INSERT INTO "benchmark_search_documents" (
        "benchmark_test_id",
        "document_text",
        "content_hash",
        "embedding",
        "embedding_spec_id",
        "embedding_dimensions",
        "source_updated_at",
        "embedded_at",
        "created_at",
        "updated_at"
      ) VALUES (
        ${data.benchmarkTestId},
        ${data.documentText},
        ${data.contentHash},
        ${vector}::vector,
        ${data.embeddingSpecId},
        ${data.embedding.length},
        ${data.sourceUpdatedAt},
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT ("benchmark_test_id") DO UPDATE SET
        "document_text" = EXCLUDED."document_text",
        "content_hash" = EXCLUDED."content_hash",
        "embedding" = EXCLUDED."embedding",
        "embedding_spec_id" = EXCLUDED."embedding_spec_id",
        "embedding_dimensions" = EXCLUDED."embedding_dimensions",
        "source_updated_at" = EXCLUDED."source_updated_at",
        "embedded_at" = NOW(),
        "updated_at" = NOW()
    `;
  }

  async deleteDocument(benchmarkTestId: string): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM "benchmark_search_documents"
      WHERE "benchmark_test_id" = ${benchmarkTestId}
    `;
  }

  async deleteDocumentsOutsideSpec(embeddingSpecId: string): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE FROM "benchmark_search_documents"
      WHERE "embedding_spec_id" <> ${embeddingSpecId}
    `;
  }

  async invalidateAllDocuments(): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "benchmark_search_documents"
      SET "source_updated_at" = TO_TIMESTAMP(0),
          "updated_at" = NOW()
    `;
  }

  async deleteDocumentsBySuite(benchmarkId: string): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE FROM "benchmark_search_documents" AS documents
      USING "catalog_test_projections" AS tests
      WHERE documents."benchmark_test_id" = tests."test_id"
        AND tests."benchmark_id" = ${benchmarkId}
    `;
  }

  async search(params: {
    query: string;
    embedding: readonly number[];
    embeddingSpecId: string;
    limit: number;
  }): Promise<SearchDocumentRow[]> {
    const vector = this.vectorLiteral(params.embedding);

    return this.searchProjection(params, vector);
  }

  async searchText(query: string, limit: number): Promise<SearchDocumentRow[]> {
    return executeSearchQuery<SearchDocumentRow>(this.prisma, Prisma.sql`
      WITH query AS (
        SELECT websearch_to_tsquery('russian', ${query}) AS ru,
               websearch_to_tsquery('english', ${query}) AS en
      ), documents AS (
        SELECT fresh.*,
          to_tsvector('russian', document) AS search_ru,
          to_tsvector('english', document) AS search_en
        FROM (${this.freshProjectionDocuments()}) AS fresh
      )
      SELECT "test_id" AS "testId", document,
        0::double precision AS "vectorScore",
        GREATEST(ts_rank_cd(search_ru, query.ru, 32),
                 ts_rank_cd(search_en, query.en, 32))::double precision AS score,
        "source_updated_at" AS "sourceUpdatedAt"
      FROM documents CROSS JOIN query
      WHERE search_ru @@ query.ru OR search_en @@ query.en
      ORDER BY score DESC, "test_id"
      LIMIT ${limit}
    `);
  }

  async searchNaive(query: string, limit: number): Promise<LegacyInterviewerSearchRow[]> {
    const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
      .filter((term) => term.length >= 2).slice(0, 32);
    if (!terms.length) return [];

    const words = Prisma.join(terms.map((term) => Prisma.sql`(${term}::text)`));
    return executeSearchQuery<LegacyInterviewerSearchRow>(this.prisma, Prisma.sql`
      WITH words(term) AS (VALUES ${words}), eligible AS (
        SELECT tests."test_id",
          concat_ws(' ', tests."name", tests."name_en", tests."description",
            tests."description_en", suites."name", suites."name_en",
            suites."description", suites."description_en") AS document,
          tests."snapshot" #>> '{specification,datasetSubsamples,0,id}' AS "datasetId",
          concat_ws(' ',
            tests."snapshot" #>> '{specification,datasetSubsamples,0,name}',
            tests."snapshot" #>> '{specification,datasetSubsamples,0,description}')
            AS "datasetDescription"
        FROM "catalog_test_projections" AS tests
        INNER JOIN "catalog_benchmark_projections" AS suites
          ON suites."benchmark_id" = tests."benchmark_id"
        INNER JOIN "catalog_entries" AS entries ON entries."test_id" = tests."test_id"
        WHERE entries."status" = 'published' AND entries."archived_at" IS NULL
          AND tests."deleted_at" IS NULL
          AND tests."snapshot" IS NOT NULL
          AND tests."name" IS NOT NULL
          AND tests."name_en" IS NOT NULL
          AND tests."source_created_at" IS NOT NULL
          AND suites."deleted_at" IS NULL
          AND suites."name" IS NOT NULL
          AND suites."name_en" IS NOT NULL
          AND suites."source_created_at" IS NOT NULL
      )
      SELECT eligible."test_id" AS "testId", eligible.document,
        COUNT(*)::double precision / ${terms.length} AS score,
        eligible."datasetId", eligible."datasetDescription"
      FROM eligible INNER JOIN words ON strpos(lower(eligible.document), words.term) > 0
      GROUP BY eligible."test_id", eligible.document,
        eligible."datasetId", eligible."datasetDescription"
      ORDER BY score DESC, eligible."test_id"
      LIMIT ${limit}
    `);
  }

  private async findPublishedProjectionIds(benchmarkId?: string): Promise<string[]> {
    const visibleTestIds = await publishedTestIds(this.prisma);
    if (!visibleTestIds.length) return [];

    const tests = await this.prisma.catalogTestProjection.findMany({
      where: {
        testId: { in: visibleTestIds },
        benchmarkId: benchmarkId ?? { not: null },
        deletedAt: null,
        snapshot: { not: Prisma.DbNull },
        name: { not: null },
        nameEn: { not: null },
        sourceCreatedAt: { not: null },
      },
      select: { testId: true, benchmarkId: true },
      orderBy: { testId: 'asc' },
    });
    const suiteIds = [
      ...new Set(tests.map(({ benchmarkId: id }) => id).filter((id): id is string => Boolean(id))),
    ];
    const suites = await this.prisma.catalogBenchmarkProjection.findMany({
      where: {
        benchmarkId: { in: suiteIds },
        deletedAt: null,
        name: { not: null },
        nameEn: { not: null },
        sourceCreatedAt: { not: null },
      },
      select: { benchmarkId: true },
    });
    const activeSuiteIds = new Set(suites.map(({ benchmarkId: id }) => id));
    return tests
      .filter(({ benchmarkId: id }) => id && activeSuiteIds.has(id))
      .map(({ testId }) => testId);
  }

  private async findProjectionSources(ids: readonly string[]): Promise<BenchmarkSearchSource[]> {
    if (!ids.length) return [];

    const projections = await this.prisma.catalogTestProjection.findMany({
      where: {
        testId: { in: [...ids] },
        benchmarkId: { not: null },
        snapshot: { not: Prisma.DbNull },
        name: { not: null },
        nameEn: { not: null },
        sourceCreatedAt: { not: null },
      },
      select: {
        testId: true,
        benchmarkId: true,
        deletedAt: true,
        sourceUpdatedAt: true,
      },
      orderBy: { testId: 'asc' },
    });
    const suiteIds = [
      ...new Set(
        projections.map(({ benchmarkId }) => benchmarkId).filter((id): id is string => Boolean(id))
      ),
    ];
    const suites = await this.prisma.catalogBenchmarkProjection.findMany({
      where: {
        benchmarkId: { in: suiteIds },
        name: { not: null },
        nameEn: { not: null },
        sourceCreatedAt: { not: null },
      },
    });
    const suiteById = new Map(suites.map((suite) => [suite.benchmarkId, suite]));
    const catalogEntries = await this.prisma.catalogEntry.findMany({
      where: { testId: { in: projections.map(({ testId }) => testId) } },
      select: {
        testId: true,
        status: true,
        archivedAt: true,
      },
    });
    const catalogEntryByTestId = new Map(catalogEntries.map((entry) => [entry.testId, entry]));
    const hydrated = await this.projectionHydrator.hydrate(
      projections.map(({ testId }) => testId),
      BenchmarkTestReadScope.Management
    );
    const hydratedById = new Map(hydrated.map((test) => [test.id, test]));

    return projections.flatMap((projection) => {
      const test = hydratedById.get(projection.testId);
      const suite = projection.benchmarkId ? suiteById.get(projection.benchmarkId) : undefined;
      if (!test || !suite || !suite.name || !suite.nameEn) return [];
      return [
        this.fromProjectionSource(
          test,
          projection,
          suite,
          catalogEntryByTestId.get(projection.testId) ?? null
        ),
      ];
    });
  }

  private fromProjectionSource(
    test: BenchmarkType,
    projection: { deletedAt: Date | null; sourceUpdatedAt: Date },
    suite: {
      name: string | null;
      nameEn: string | null;
      description: string | null;
      descriptionEn: string | null;
      deletedAt: Date | null;
    },
    catalogEntry: {
      status: BenchmarkValidationStatus;
      archivedAt: Date | null;
    } | null
  ): BenchmarkSearchSource {
    return {
      id: test.id,
      name: test.name,
      nameEn: test.nameEn,
      description: test.description || null,
      descriptionEn: test.descriptionEn || null,
      shortDescription: test.shortDescription ?? null,
      taskDescription: test.taskDescription ?? null,
      instructions: test.instructions || null,
      instructionsEn: test.instructionsEn || null,
      contextFieldFormat: test.contextFieldFormat ?? null,
      answerFieldFormat: test.answerFieldFormat ?? null,
      evaluationLogic: test.evaluationLogic ?? null,
      recommendedMetricsDescription: test.recommendedMetricsDescription ?? null,
      requiredGigaChatQualityLevel: test.requiredGigaChatQualityLevel ?? null,
      deletedAt: projection.deletedAt,
      updatedAt: projection.sourceUpdatedAt,
      benchmark: {
        name: suite.name!,
        nameEn: suite.nameEn!,
        description: suite.description,
        descriptionEn: suite.descriptionEn,
        deletedAt: suite.deletedAt,
      },
      macroGroup: test.macroGroup,
      taskType: test.taskType,
      language: test.language,
      difficulty: test.difficulty,
      skills: test.skills,
      abilityTags: test.abilityTags,
      subGroups: test.subGroups,
      abilityTaxons: test.abilityTaxons,
      domains: test.domains,
      subdomains: test.subdomains,
      modalities: test.modalities,
      capabilities: test.capabilities,
      datasetSubsamples: test.datasetSubsamples.map((subsample) => ({
        name: subsample.name,
        nameEn: subsample.nameEn || null,
        description: subsample.description ?? null,
        split: subsample.split ?? null,
      })),
      catalogEntry,
    };
  }

  private freshProjectionDocuments(): Prisma.Sql {
    // Lexical eligibility is independent of embedding availability. Always use
    // current projections and dictionaries: a Test timestamp cannot detect a
    // suite/taxonomy update when its dependent embedding refresh fails.
    return Prisma.sql`
      SELECT tests."test_id", tests."source_updated_at",
        concat_ws(' ', tests."name", tests."name_en", tests."description",
          tests."description_en", suites."name", suites."name_en",
          suites."description", suites."description_en",
          tests."snapshot" #>> '{specification,shortDescription}',
          tests."snapshot" #>> '{specification,taskDescription}',
          tests."snapshot" #>> '{specification,instructions}',
          tests."snapshot" #>> '{specification,instructionsEn}',
          tests."snapshot" #>> '{specification,contextFieldFormat}',
          tests."snapshot" #>> '{specification,answerFieldFormat}',
          tests."snapshot" #>> '{specification,evaluationLogic}',
          tests."snapshot" #>> '{specification,recommendedMetricsDescription}',
          tests."snapshot" #>> '{specification,requiredGigaChatQualityLevel}',
          tests."snapshot" #>> '{specification,skills}',
          tests."snapshot" #>> '{specification,abilityTags}',
          taxonomy.names,
          jsonb_path_query_array(tests."snapshot", '$.specification.datasetSubsamples[*].name')::text,
          jsonb_path_query_array(tests."snapshot", '$.specification.datasetSubsamples[*].nameEn')::text,
          jsonb_path_query_array(tests."snapshot", '$.specification.datasetSubsamples[*].description')::text,
          jsonb_path_query_array(tests."snapshot", '$.specification.datasetSubsamples[*].split')::text)
          AS document
      FROM "catalog_test_projections" AS tests
      INNER JOIN "catalog_benchmark_projections" AS suites
        ON suites."benchmark_id" = tests."benchmark_id"
      INNER JOIN "catalog_entries" AS entries ON entries."test_id" = tests."test_id"
      LEFT JOIN LATERAL (
        SELECT string_agg(concat_ws(' ', name, name_en), ' ' ORDER BY name, name_en) AS names
        FROM (
          SELECT name, name_en FROM taxonomy_macro_groups WHERE id = tests.macro_group_id
          UNION ALL SELECT name, name_en FROM taxonomy_task_types WHERE id = tests.task_type_id
          UNION ALL SELECT name, name_en FROM taxonomy_languages WHERE id = tests.language_id
          UNION ALL SELECT name, name_en FROM taxonomy_difficulties WHERE id = tests.difficulty_id
          UNION ALL SELECT name, name_en FROM taxonomy_sub_groups WHERE id = ANY(tests.sub_group_ids)
          UNION ALL SELECT name, name_en FROM taxonomy_ability_taxons WHERE id = ANY(tests.ability_taxon_ids)
          UNION ALL SELECT name, name_en FROM taxonomy_domains WHERE id = ANY(tests.domain_ids)
          UNION ALL SELECT name, name_en FROM taxonomy_subdomains WHERE id = ANY(tests.subdomain_ids)
          UNION ALL SELECT name, name_en FROM taxonomy_modalities WHERE id = ANY(tests.modality_ids)
          UNION ALL SELECT name, name_en FROM taxonomy_capabilities WHERE id = ANY(tests.capability_ids)
        ) AS labels
      ) AS taxonomy ON true
      WHERE entries."status" = 'published' AND entries."archived_at" IS NULL
        AND tests."deleted_at" IS NULL
        AND tests."snapshot" IS NOT NULL
        AND tests."name" IS NOT NULL AND tests."name_en" IS NOT NULL
        AND tests."source_created_at" IS NOT NULL
        AND suites."deleted_at" IS NULL
        AND suites."name" IS NOT NULL AND suites."name_en" IS NOT NULL
        AND suites."source_created_at" IS NOT NULL
    `;
  }

  private searchProjection(
    params: {
      query: string;
      embedding: readonly number[];
      embeddingSpecId: string;
      limit: number;
    },
    vector: string
  ): Promise<SearchDocumentRow[]> {
    // Bounded oversampling approximates fusion over both complete rankings.
    const candidateLimit = Math.min(params.limit * 5, 500);
    return executeSearchQuery<SearchDocumentRow>(this.prisma, Prisma.sql`
      WITH fresh AS MATERIALIZED (${this.freshProjectionDocuments()}),
      eligible_vectors AS MATERIALIZED (
        SELECT documents."benchmark_test_id" AS "test_id", documents."embedding"
        FROM "benchmark_search_documents" AS documents
        INNER JOIN fresh ON fresh."test_id" = documents."benchmark_test_id"
        WHERE documents."embedding_spec_id" = ${params.embeddingSpecId}
          AND documents."embedding_dimensions" = ${params.embedding.length}
          AND vector_dims(documents."embedding") = ${params.embedding.length}
          AND documents."source_updated_at" = fresh."source_updated_at"
      ), query AS (
        SELECT websearch_to_tsquery('russian', ${params.query}) AS ru,
               websearch_to_tsquery('english', ${params.query}) AS en
      ), vector_candidates AS (
        SELECT "test_id", "embedding" <=> ${vector}::vector AS distance
        FROM eligible_vectors
        WHERE ("embedding" <=> ${vector}::vector) IS NOT NULL
        ORDER BY distance, "test_id"
        LIMIT ${candidateLimit}
      ), vector_ranked AS (
        SELECT *, ROW_NUMBER() OVER (ORDER BY distance, "test_id") AS rank
        FROM vector_candidates
      ), text_documents AS (
        SELECT "test_id",
          to_tsvector('russian', document) AS search_ru,
          to_tsvector('english', document) AS search_en
        FROM fresh
      ), text_candidates AS (
        SELECT "test_id",
          GREATEST(ts_rank_cd(search_ru, query.ru, 32),
                   ts_rank_cd(search_en, query.en, 32)) AS relevance
        FROM text_documents CROSS JOIN query
        WHERE search_ru @@ query.ru OR search_en @@ query.en
        ORDER BY relevance DESC, "test_id"
        LIMIT ${candidateLimit}
      ), text_ranked AS (
        SELECT *, ROW_NUMBER() OVER (ORDER BY relevance DESC, "test_id") AS rank
        FROM text_candidates
      ), fused AS (
        SELECT COALESCE(v."test_id", t."test_id") AS id,
          COALESCE(1 - v.distance, 0) AS vector_score,
          t.rank AS text_rank,
          (COALESCE(1.0 / (60 + v.rank), 0) +
           COALESCE(1.0 / (60 + t.rank), 0)) * 30.5 AS score
        FROM vector_ranked v FULL OUTER JOIN text_ranked t ON v."test_id" = t."test_id"
      )
      SELECT fresh."test_id" AS "testId", fresh.document,
        fused.vector_score::double precision AS "vectorScore",
        fused.score::double precision AS score,
        fresh."source_updated_at" AS "sourceUpdatedAt"
      FROM fused INNER JOIN fresh ON fresh."test_id" = fused.id
      ORDER BY fused.score DESC, fused.text_rank NULLS LAST, "testId"
      LIMIT ${params.limit}
    `);
  }

  private vectorLiteral(values: readonly number[]): string {
    if (0 === values.length || values.some((value) => !Number.isFinite(value))) {
      throw new Error('Cannot serialize an empty or invalid embedding');
    }

    return `[${values.join(',')}]`;
  }
}
