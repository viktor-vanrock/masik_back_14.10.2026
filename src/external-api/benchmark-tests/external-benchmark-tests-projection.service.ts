import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BenchmarkTestSnapshotV1,
  parseBenchmarkTestSnapshotV1,
} from '@/benchmark-service/contracts/benchmark-integration.v1';
import { BenchmarkTestReadScope } from '@/catalog/benchmark-test/benchmark-test-read-scope';
import { BenchmarkType } from '@/catalog/benchmark-test/types';
import { CatalogTestProjectionHydrator } from '@/catalog/projection/catalog-test-projection-hydrator.service';
import { SortDirection } from '@/common/enums/sortDirection.enum';
import { BenchmarkValidationStatus, Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  ExternalBenchmarkTestListResponseDto,
  ExternalBenchmarkTestDto,
} from './dto/externalBenchmarkTestResponseDto.dto';
import {
  ExternalBenchmarkTestSearchDto,
  ExternalBenchmarkTestSortColumn,
  ExternalDateRangeDto,
  ExternalNumberRangeDto,
} from './dto/externalBenchmarkTestSearchDto.dto';
import { ExternalBenchmarkTestField } from './types';

type IdRow = { id: string };
type CountRow = { count: number };
type StringValueRow = { value: string };

@Injectable()
export class ExternalBenchmarkTestsProjectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hydrator: CatalogTestProjectionHydrator
  ) {}

  async search(
    dto: ExternalBenchmarkTestSearchDto
  ): Promise<ExternalBenchmarkTestListResponseDto> {
    const page = dto.pagination?.page ?? 1;
    const limit = dto.pagination?.limit ?? 50;
    const skip = (page - 1) * limit;
    const where = Prisma.join(this.buildWhere(dto), ' AND ');

    const [rows, counts] = await this.prisma.$transaction([
      this.prisma.$queryRaw<IdRow[]>(Prisma.sql`
        SELECT p."test_id" AS "id"
        FROM "catalog_test_projections" p
        INNER JOIN "catalog_benchmark_projections" b
          ON b."benchmark_id" = p."benchmark_id"
        INNER JOIN "catalog_entries" ce ON ce."test_id" = p."test_id"
        LEFT JOIN "taxonomy_difficulties" difficulty
          ON difficulty."id" = p."difficulty_id"
        LEFT JOIN "taxonomy_languages" language
          ON language."id" = p."language_id"
        WHERE ${where}
        ORDER BY ${this.buildOrderBy(dto)}
        OFFSET ${skip}
        LIMIT ${limit}
      `),
      this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::INTEGER AS "count"
        FROM "catalog_test_projections" p
        INNER JOIN "catalog_benchmark_projections" b
          ON b."benchmark_id" = p."benchmark_id"
        INNER JOIN "catalog_entries" ce ON ce."test_id" = p."test_id"
        WHERE ${where}
      `),
    ]);

    return {
      data: await this.hydrate(rows.map(({ id }) => id)),
      total: counts[0]?.count ?? 0,
      page,
      limit,
    };
  }

  async findById(id: string): Promise<ExternalBenchmarkTestDto> {
    const where = Prisma.join(
      [...this.activePublishedWhere(), Prisma.sql`p."test_id" = ${id}`],
      ' AND '
    );
    const rows = await this.prisma.$queryRaw<IdRow[]>(Prisma.sql`
      SELECT p."test_id" AS "id"
      FROM "catalog_test_projections" p
      INNER JOIN "catalog_benchmark_projections" b
        ON b."benchmark_id" = p."benchmark_id"
      INNER JOIN "catalog_entries" ce ON ce."test_id" = p."test_id"
      WHERE ${where}
      LIMIT 1
    `);
    if (!rows.length) {
      throw new NotFoundException(
        `Benchmark test with id "${id}" was not found`
      );
    }

    return (await this.hydrate([id]))[0];
  }

  async findDistinctValues(
    field: ExternalBenchmarkTestField
  ): Promise<Array<string | boolean>> {
    switch (field) {
      case ExternalBenchmarkTestField.MacroGroup:
        return this.dictionaryValues('taxonomy_macro_groups');
      case ExternalBenchmarkTestField.TaskType:
        return this.dictionaryValues('taxonomy_task_types');
      case ExternalBenchmarkTestField.Language:
        return this.dictionaryValues('taxonomy_languages');
      case ExternalBenchmarkTestField.Difficulty:
        return this.dictionaryValues('taxonomy_difficulties');
      case ExternalBenchmarkTestField.AbilityTaxons:
        return this.dictionaryValues('taxonomy_ability_taxons');
      case ExternalBenchmarkTestField.SubGroups:
        return this.dictionaryValues('taxonomy_sub_groups');
      case ExternalBenchmarkTestField.Domains:
        return this.dictionaryValues('taxonomy_domains');
      case ExternalBenchmarkTestField.Subdomains:
        return this.dictionaryValues('taxonomy_subdomains');
      case ExternalBenchmarkTestField.Modalities:
        return this.dictionaryValues('taxonomy_modalities');
      case ExternalBenchmarkTestField.ValidationStatus:
        return [BenchmarkValidationStatus.published];
      case ExternalBenchmarkTestField.IsGenerated:
        return [false, true];
      case ExternalBenchmarkTestField.Skills:
        return this.arrayValues('skills');
      case ExternalBenchmarkTestField.AbilityTags:
        return this.arrayValues('ability_tags');
      case ExternalBenchmarkTestField.MetricNames:
        return this.metricNames();
      case ExternalBenchmarkTestField.LinkTypes:
        return this.linkTypes();
      case ExternalBenchmarkTestField.Id:
        return this.scalarValues('p."test_id"');
      case ExternalBenchmarkTestField.BenchmarkId:
        return this.scalarValues('p."benchmark_id"');
      case ExternalBenchmarkTestField.Name:
        return this.scalarValues('p."name"');
      case ExternalBenchmarkTestField.NameEn:
        return this.scalarValues('p."name_en"');
      case ExternalBenchmarkTestField.KnowledgeLevel:
        return this.scalarValues(
          'p."snapshot" #>> \'{specification,knowledgeLevel}\''
        );
      case ExternalBenchmarkTestField.ConfidentialityLevel:
        return this.scalarValues(
          'p."snapshot" #>> \'{specification,confidentialityLevel}\''
        );
      case ExternalBenchmarkTestField.Importance:
        return this.scalarValues(
          'p."snapshot" #>> \'{specification,importance}\''
        );
      default:
        throw new BadRequestException('Unsupported field');
    }
  }

  private buildWhere(dto: ExternalBenchmarkTestSearchDto): Prisma.Sql[] {
    const clauses = this.activePublishedWhere();
    const filters = dto.filters;
    if (!filters) return clauses;

    if (this.hasText(filters.search)) {
      const value = filters.search.trim();
      const search = `%${this.escapeLike(value)}%`;
      const searchClauses = [
        Prisma.sql`p."name" ILIKE ${search}`,
        Prisma.sql`p."name_en" ILIKE ${search}`,
        Prisma.sql`p."description" ILIKE ${search}`,
        Prisma.sql`p."description_en" ILIKE ${search}`,
        Prisma.sql`p."short_description" ILIKE ${search}`,
        Prisma.sql`p."task_description" ILIKE ${search}`,
        Prisma.sql`b."name" ILIKE ${search}`,
        Prisma.sql`b."name_en" ILIKE ${search}`,
      ];
      if (this.isUuid(value)) {
        searchClauses.push(
          Prisma.sql`p."test_id" = ${value}`,
          Prisma.sql`p."benchmark_id" = ${value}`
        );
      }
      clauses.push(Prisma.sql`(${Prisma.join(searchClauses, ' OR ')})`);
    }
    if (this.hasText(filters.benchmarkId)) {
      if (!this.isUuid(filters.benchmarkId)) {
        throw new BadRequestException('benchmarkId must be a valid UUID');
      }
      clauses.push(Prisma.sql`p."benchmark_id" = ${filters.benchmarkId}`);
    }

    this.addDictionaryContains(
      clauses,
      'taxonomy_macro_groups',
      'p."macro_group_id"',
      filters.macroGroup
    );
    this.addDictionaryContains(
      clauses,
      'taxonomy_task_types',
      'p."task_type_id"',
      filters.taskType
    );
    this.addDictionaryContains(
      clauses,
      'taxonomy_languages',
      'p."language_id"',
      filters.language
    );
    this.addDictionaryContains(
      clauses,
      'taxonomy_difficulties',
      'p."difficulty_id"',
      filters.difficulty
    );

    if (
      filters.validationStatus !== undefined &&
      filters.validationStatus !== null &&
      BenchmarkValidationStatus.published !== filters.validationStatus
    ) {
      clauses.push(Prisma.sql`FALSE`);
    }
    this.addJsonStringEquals(
      clauses,
      'knowledgeLevel',
      filters.knowledgeLevel
    );
    this.addJsonStringEquals(
      clauses,
      'confidentialityLevel',
      filters.confidentialityLevel
    );
    this.addJsonStringEquals(clauses, 'importance', filters.importance);
    if (filters.isGenerated !== undefined && filters.isGenerated !== null) {
      clauses.push(Prisma.sql`
        COALESCE(
          (p."snapshot" #>> '{specification,isGenerated}')::BOOLEAN,
          FALSE
        ) = ${filters.isGenerated}
      `);
    }

    this.addTextArrayOverlap(clauses, 'skills', filters.skills);
    this.addTextArrayOverlap(clauses, 'ability_tags', filters.abilityTags);
    this.addDictionaryArrayNames(
      clauses,
      'taxonomy_ability_taxons',
      'ability_taxon_ids',
      filters.abilityTaxons
    );
    this.addDictionaryArrayNames(
      clauses,
      'taxonomy_sub_groups',
      'sub_group_ids',
      filters.subGroups
    );
    this.addDictionaryArrayNames(
      clauses,
      'taxonomy_domains',
      'domain_ids',
      filters.domains
    );
    this.addDictionaryArrayNames(
      clauses,
      'taxonomy_subdomains',
      'subdomain_ids',
      filters.subdomains
    );
    this.addDictionaryArrayNames(
      clauses,
      'taxonomy_modalities',
      'modality_ids',
      filters.modalities
    );
    if (filters.metricNames?.length) {
      clauses.push(Prisma.sql`EXISTS (
        SELECT 1
        FROM "metric_definitions" metric
        WHERE metric."id" = ANY(p."metric_ids")
          AND metric."name" IN (${Prisma.join(filters.metricNames)})
      )`);
    }
    if (filters.linkTypes?.length) {
      clauses.push(Prisma.sql`EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          COALESCE(
            p."snapshot" #> '{specification,links}',
            '[]'::JSONB
          )
        ) link
        WHERE link ->> 'type' IN (${Prisma.join(filters.linkTypes)})
      )`);
    }

    this.addNumberRange(clauses, 'p."size_in_samples"', filters.sizeInSamples);
    this.addNumberRange(
      clauses,
      `NULLIF(
        p."snapshot" #>> '{specification,medianSampleSizeWords}',
        ''
      )::NUMERIC`,
      filters.medianSampleSizeWords
    );
    this.addNumberRange(
      clauses,
      `NULLIF(
        p."snapshot" #>> '{specification,confidenceScore}',
        ''
      )::NUMERIC`,
      filters.confidenceScore
    );
    this.addDateRange(clauses, 'p."source_created_at"', filters.createdAt);
    this.addDateRange(clauses, 'p."source_updated_at"', filters.updatedAt);
    this.addDateRange(
      clauses,
      `NULLIF(
        p."snapshot" #>> '{specification,generatedAt}',
        ''
      )::TIMESTAMPTZ`,
      filters.generatedAt
    );

    return clauses;
  }

  private activePublishedWhere(): Prisma.Sql[] {
    return [
      Prisma.sql`p."deleted_at" IS NULL`,
      Prisma.sql`p."snapshot" IS NOT NULL`,
      Prisma.sql`p."name" IS NOT NULL`,
      Prisma.sql`p."name_en" IS NOT NULL`,
      Prisma.sql`p."benchmark_id" IS NOT NULL`,
      Prisma.sql`p."source_created_at" IS NOT NULL`,
      Prisma.sql`b."deleted_at" IS NULL`,
      Prisma.sql`b."name" IS NOT NULL`,
      Prisma.sql`b."name_en" IS NOT NULL`,
      Prisma.sql`b."source_created_at" IS NOT NULL`,
      Prisma.sql`ce."status" = ${BenchmarkValidationStatus.published}::"BenchmarkValidationStatus"`,
      Prisma.sql`ce."archived_at" IS NULL`,
    ];
  }

  private buildOrderBy(dto: ExternalBenchmarkTestSearchDto): Prisma.Sql {
    const direction =
      SortDirection.Asc === dto.sort?.direction
        ? Prisma.raw('ASC')
        : Prisma.raw('DESC');

    switch (dto.sort?.column) {
      case ExternalBenchmarkTestSortColumn.Name:
        return Prisma.sql`p."name" ${direction} NULLS LAST, p."test_id" ASC`;
      case ExternalBenchmarkTestSortColumn.NameEn:
        return Prisma.sql`p."name_en" ${direction} NULLS LAST, p."test_id" ASC`;
      case ExternalBenchmarkTestSortColumn.SizeInSamples:
        return Prisma.sql`p."size_in_samples" ${direction} NULLS LAST, p."test_id" ASC`;
      case ExternalBenchmarkTestSortColumn.Difficulty:
        return Prisma.sql`difficulty."name" ${direction} NULLS LAST, p."test_id" ASC`;
      case ExternalBenchmarkTestSortColumn.Language:
        return Prisma.sql`language."name" ${direction} NULLS LAST, p."test_id" ASC`;
      case ExternalBenchmarkTestSortColumn.UpdatedAt:
        return Prisma.sql`p."source_updated_at" ${direction} NULLS LAST, p."test_id" ASC`;
      case ExternalBenchmarkTestSortColumn.CreatedAt:
      default:
        return Prisma.sql`p."source_created_at" ${direction} NULLS LAST, p."test_id" ASC`;
    }
  }

  private async hydrate(ids: string[]): Promise<ExternalBenchmarkTestDto[]> {
    if (!ids.length) return [];

    const [tests, projectionRows] = await Promise.all([
      this.hydrator.hydrate(ids, BenchmarkTestReadScope.Public),
      this.prisma.catalogTestProjection.findMany({
        where: { testId: { in: ids } },
        select: { testId: true, benchmarkId: true, snapshot: true },
      }),
    ]);
    const snapshots = new Map<string, BenchmarkTestSnapshotV1>();
    for (const row of projectionRows) {
      snapshots.set(row.testId, parseBenchmarkTestSnapshotV1(row.snapshot));
    }
    const suiteIds = this.unique(
      projectionRows
        .map(({ benchmarkId }) => benchmarkId)
        .filter((id): id is string => Boolean(id))
    );
    const metricIds = this.unique(
      [...snapshots.values()].flatMap(
        ({ specification }) => specification.metricIds
      )
    );
    const [suites, metrics] = await Promise.all([
      this.prisma.catalogBenchmarkProjection.findMany({
        where: { benchmarkId: { in: suiteIds } },
      }),
      this.prisma.metricDefinition.findMany({
        where: { id: { in: metricIds } },
        include: { priority: true, direction: true },
      }),
    ]);
    const testById = new Map(tests.map((test) => [test.id, test]));
    const suiteById = new Map(
      suites.map((suite) => [suite.benchmarkId, suite])
    );
    const metricById = new Map(metrics.map((metric) => [metric.id, metric]));

    return ids.map((id) => {
      const test = testById.get(id)!;
      const snapshot = snapshots.get(id)!;
      const suite = suiteById.get(snapshot.specification.suiteId.toLowerCase())!;
      return this.toDto(test, snapshot, suite, metricById);
    });
  }

  private toDto(
    test: BenchmarkType,
    snapshot: BenchmarkTestSnapshotV1,
    suite: {
      benchmarkId: string;
      name: string | null;
      nameEn: string | null;
      description: string | null;
      descriptionEn: string | null;
    },
    metricById: Map<
      string,
      {
        id: string;
        name: string;
        displayName: string | null;
        priority: { code: string };
        direction: { code: string };
      }
    >
  ): ExternalBenchmarkTestDto {
    const specification = snapshot.specification;
    return {
      id: test.id,
      benchmark: {
        id: suite.benchmarkId,
        name: suite.name!,
        nameEn: suite.nameEn!,
        description: suite.description ?? undefined,
        descriptionEn: suite.descriptionEn ?? undefined,
      },
      name: test.name,
      nameEn: test.nameEn,
      description: test.description,
      descriptionEn: test.descriptionEn,
      shortDescription: test.shortDescription,
      taskDescription: test.taskDescription,
      taskType: test.taskType?.name,
      language: test.language?.name,
      difficulty: test.difficulty?.name,
      sizeInSamples: test.sizeInSamples,
      medianSampleSizeWords: test.medianSampleSizeWords,
      validationStatus: test.validationStatus,
      taxonomy: {
        macroGroup: test.macroGroup?.name,
        subGroups: test.subGroups.map(({ name }) => name),
        skills: test.skills,
        abilityTaxons: test.abilityTaxons.map(({ name }) => name),
        abilityTags: test.abilityTags,
        domains: test.domains.map(({ name }) => name),
        subdomains: test.subdomains.map(({ name }) => name),
        modalities: test.modalities.map(({ name }) => name),
      },
      metrics: specification.metricIds
        .map((id) => metricById.get(id.toLowerCase()))
        .filter((metric) => undefined !== metric)
        .map((metric) => ({
          id: metric.id,
          name: metric.name,
          displayName: metric.displayName ?? undefined,
          priority: metric.priority.code,
          direction: metric.direction.code,
        })),
      gigaMetrics: {
        codebaseUrl: test.gigaMetricsCodebaseUrl,
        adapterName: test.gigaMetricAdapterName,
        setUrl: test.gigaMetricSetUrl,
        launchCommand: test.gigaMetricLaunchCommand,
      },
      links: test.links.map((link) => ({ ...link })),
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
    };
  }

  private addDictionaryContains(
    clauses: Prisma.Sql[],
    table: string,
    projectionColumn: string,
    value: string | undefined
  ): void {
    if (!this.hasText(value)) return;
    const search = `%${this.escapeLike(value.trim())}%`;
    clauses.push(Prisma.sql`EXISTS (
      SELECT 1 FROM ${Prisma.raw(`"${table}"`)} dictionary
      WHERE dictionary."id" = ${Prisma.raw(projectionColumn)}
        AND dictionary."name" ILIKE ${search}
    )`);
  }

  private addDictionaryArrayNames(
    clauses: Prisma.Sql[],
    table: string,
    projectionColumn: string,
    values: string[] | undefined
  ): void {
    if (!values?.length) return;
    clauses.push(Prisma.sql`EXISTS (
      SELECT 1 FROM ${Prisma.raw(`"${table}"`)} dictionary
      WHERE dictionary."id" = ANY(${Prisma.raw(`p."${projectionColumn}"`)})
        AND dictionary."name" IN (${Prisma.join(values)})
    )`);
  }

  private addTextArrayOverlap(
    clauses: Prisma.Sql[],
    column: 'skills' | 'ability_tags',
    values: string[] | undefined
  ): void {
    if (!values?.length) return;
    clauses.push(
      Prisma.sql`${Prisma.raw(`p."${column}"`)} && ARRAY[${Prisma.join(values)}]::VARCHAR(255)[]`
    );
  }

  private addJsonStringEquals(
    clauses: Prisma.Sql[],
    field: 'knowledgeLevel' | 'confidentialityLevel' | 'importance',
    value: string | undefined
  ): void {
    if (!this.hasText(value)) return;
    clauses.push(
      Prisma.sql`${Prisma.raw(`p."snapshot" #>> '{specification,${field}}'`)} = ${value}`
    );
  }

  private addNumberRange(
    clauses: Prisma.Sql[],
    expression: string,
    range: ExternalNumberRangeDto | undefined
  ): void {
    if (!range) return;
    if (range.gte !== undefined && range.gte !== null) {
      clauses.push(Prisma.sql`${Prisma.raw(expression)} >= ${range.gte}`);
    }
    if (range.lte !== undefined && range.lte !== null) {
      clauses.push(Prisma.sql`${Prisma.raw(expression)} <= ${range.lte}`);
    }
  }

  private addDateRange(
    clauses: Prisma.Sql[],
    expression: string,
    range: ExternalDateRangeDto | undefined
  ): void {
    if (!range) return;
    if (range.gte) {
      clauses.push(
        Prisma.sql`${Prisma.raw(expression)} >= ${new Date(range.gte)}`
      );
    }
    if (range.lte) {
      clauses.push(
        Prisma.sql`${Prisma.raw(expression)} <= ${new Date(range.lte)}`
      );
    }
  }

  private async dictionaryValues(table: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<StringValueRow[]>(Prisma.sql`
      SELECT dictionary."name" AS "value"
      FROM ${Prisma.raw(`"${table}"`)} dictionary
      WHERE dictionary."deleted_at" IS NULL
      ORDER BY dictionary."name" ASC
    `);
    return rows.map(({ value }) => value);
  }

  private async scalarValues(expression: string): Promise<string[]> {
    const where = Prisma.join(this.activePublishedWhere(), ' AND ');
    const rows = await this.prisma.$queryRaw<StringValueRow[]>(Prisma.sql`
      SELECT DISTINCT ${Prisma.raw(expression)} AS "value"
      FROM "catalog_test_projections" p
      INNER JOIN "catalog_benchmark_projections" b
        ON b."benchmark_id" = p."benchmark_id"
      INNER JOIN "catalog_entries" ce ON ce."test_id" = p."test_id"
      WHERE ${where}
        AND ${Prisma.raw(expression)} IS NOT NULL
        AND ${Prisma.raw(expression)} <> ''
      ORDER BY "value" ASC
    `);
    return rows.map(({ value }) => value);
  }

  private async arrayValues(
    column: 'skills' | 'ability_tags'
  ): Promise<string[]> {
    const where = Prisma.join(this.activePublishedWhere(), ' AND ');
    const rows = await this.prisma.$queryRaw<StringValueRow[]>(Prisma.sql`
      SELECT DISTINCT values."value"
      FROM "catalog_test_projections" p
      INNER JOIN "catalog_benchmark_projections" b
        ON b."benchmark_id" = p."benchmark_id"
      INNER JOIN "catalog_entries" ce ON ce."test_id" = p."test_id"
      CROSS JOIN LATERAL unnest(
        ${Prisma.raw(`p."${column}"`)}
      ) AS values("value")
      WHERE ${where}
        AND values."value" <> ''
      ORDER BY values."value" ASC
    `);
    return rows.map(({ value }) => value);
  }

  private async metricNames(): Promise<string[]> {
    const where = Prisma.join(this.activePublishedWhere(), ' AND ');
    const rows = await this.prisma.$queryRaw<StringValueRow[]>(Prisma.sql`
      SELECT DISTINCT metric."name" AS "value"
      FROM "catalog_test_projections" p
      INNER JOIN "catalog_benchmark_projections" b
        ON b."benchmark_id" = p."benchmark_id"
      INNER JOIN "catalog_entries" ce ON ce."test_id" = p."test_id"
      INNER JOIN "metric_definitions" metric
        ON metric."id" = ANY(p."metric_ids")
      WHERE ${where}
      ORDER BY metric."name" ASC
    `);
    return rows.map(({ value }) => value);
  }

  private async linkTypes(): Promise<string[]> {
    const where = Prisma.join(this.activePublishedWhere(), ' AND ');
    const rows = await this.prisma.$queryRaw<StringValueRow[]>(Prisma.sql`
      SELECT DISTINCT link ->> 'type' AS "value"
      FROM "catalog_test_projections" p
      INNER JOIN "catalog_benchmark_projections" b
        ON b."benchmark_id" = p."benchmark_id"
      INNER JOIN "catalog_entries" ce ON ce."test_id" = p."test_id"
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(p."snapshot" #> '{specification,links}', '[]'::JSONB)
      ) link
      WHERE ${where}
        AND link ->> 'type' IS NOT NULL
      ORDER BY "value" ASC
    `);
    return rows.map(({ value }) => value);
  }

  private unique(values: string[]): string[] {
    return [...new Set(values)];
  }

  private hasText(value?: string | null): value is string {
    return 'string' === typeof value && value.trim().length > 0;
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    );
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, '\\$&');
  }
}
