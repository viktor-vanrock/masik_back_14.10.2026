import { Injectable } from '@nestjs/common';
import { SortDirection } from '@/common/enums/sortDirection.enum';
import { BenchmarkValidationStatus, Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { BenchmarkTestReadScope } from '../benchmark-test/benchmark-test-read-scope';
import {
  BenchmarkSortColumn,
  BenchmarkTestQueryDto,
} from '../benchmark-test/dto/benchmarkTestQuery.dto';
import { CatalogSubmissionQueryDto } from '../catalog-entry/dto/catalog-submission-query.dto';
import { CatalogQueryDto } from '../catalog-view/dto/catalogQuery.dto';

type ProjectionIdRow = { testId: string };
type CountRow = { count: number };
type StringValueRow = { value: string };

export type ProjectionPage = {
  ids: string[];
  total: number;
};

export type ProjectionGroupSuite = {
  id: string;
  name: string;
  nameEn: string;
  description: string | null;
  descriptionEn: string | null;
  benchmarkTestsCount: number;
  matchedTestsCount: number;
};

@Injectable()
export class CatalogTestProjectionSqlRepository {
  constructor(private readonly prisma: PrismaService) {}

  async selectIds(
    query: BenchmarkTestQueryDto,
    scope: BenchmarkTestReadScope,
    testId?: string
  ): Promise<ProjectionPage> {
    const where = Prisma.join(this.buildWhere(query, scope, testId), ' AND ');
    const visibilityJoin =
      BenchmarkTestReadScope.Public === scope
        ? Prisma.sql`INNER JOIN "catalog_entries" ce ON ce."test_id" = p."test_id"`
        : Prisma.empty;
    const page = query.page ?? 1;
    const limit = query.limit ?? 1000;
    const skip = (page - 1) * limit;

    const [rows, counts] = await this.prisma.$transaction([
      this.prisma.$queryRaw<ProjectionIdRow[]>(Prisma.sql`
        SELECT p."test_id" AS "testId"
        FROM "catalog_test_projections" p
        INNER JOIN "catalog_benchmark_projections" b
          ON b."benchmark_id" = p."benchmark_id"
        ${visibilityJoin}
        LEFT JOIN "taxonomy_difficulties" difficulty
          ON difficulty."id" = p."difficulty_id"
        LEFT JOIN "taxonomy_languages" language
          ON language."id" = p."language_id"
        WHERE ${where}
        ORDER BY ${this.buildOrderBy(query)}
        OFFSET ${skip}
        LIMIT ${limit}
      `),
      this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::INTEGER AS "count"
        FROM "catalog_test_projections" p
        INNER JOIN "catalog_benchmark_projections" b
          ON b."benchmark_id" = p."benchmark_id"
        ${visibilityJoin}
        WHERE ${where}
      `),
    ]);

    return {
      ids: rows.map(({ testId: id }) => id),
      total: counts[0]?.count ?? 0,
    };
  }

  async selectOwnedSubmissionIds(
    query: CatalogSubmissionQueryDto,
    authorId: string
  ): Promise<ProjectionPage> {
    const clauses: Prisma.Sql[] = [
      Prisma.sql`ce."author_id" = ${authorId}::UUID`,
      Prisma.sql`ce."archived_at" IS NULL`,
      Prisma.sql`p."deleted_at" IS NULL`,
      Prisma.sql`p."snapshot" IS NOT NULL`,
      Prisma.sql`p."name" IS NOT NULL`,
      Prisma.sql`p."name_en" IS NOT NULL`,
      Prisma.sql`p."benchmark_id" IS NOT NULL`,
      Prisma.sql`p."source_created_at" IS NOT NULL`,
      Prisma.sql`b."deleted_at" IS NULL`,
      Prisma.sql`b."name" IS NOT NULL`,
    ];
    if (query.status) {
      clauses.push(
        Prisma.sql`ce."status" = ${query.status}::"BenchmarkValidationStatus"`
      );
    }
    if (query.search) {
      const search = `%${this.escapeLike(query.search)}%`;
      clauses.push(Prisma.sql`(
        p."name" ILIKE ${search}
        OR p."name_en" ILIKE ${search}
        OR p."description" ILIKE ${search}
      )`);
    }

    const where = Prisma.join(clauses, ' AND ');
    const direction =
      SortDirection.Asc === query.sortDirection
        ? Prisma.raw('ASC')
        : Prisma.raw('DESC');
    const skip = (query.page - 1) * query.limit;

    const [rows, counts] = await this.prisma.$transaction([
      this.prisma.$queryRaw<ProjectionIdRow[]>(Prisma.sql`
        SELECT p."test_id" AS "testId"
        FROM "catalog_entries" ce
        INNER JOIN "catalog_test_projections" p
          ON p."test_id" = ce."test_id"
        INNER JOIN "catalog_benchmark_projections" b
          ON b."benchmark_id" = p."benchmark_id"
        WHERE ${where}
        ORDER BY p."source_created_at" ${direction} NULLS LAST, p."test_id" ASC
        OFFSET ${skip}
        LIMIT ${query.limit}
      `),
      this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::INTEGER AS "count"
        FROM "catalog_entries" ce
        INNER JOIN "catalog_test_projections" p
          ON p."test_id" = ce."test_id"
        INNER JOIN "catalog_benchmark_projections" b
          ON b."benchmark_id" = p."benchmark_id"
        WHERE ${where}
      `),
    ]);

    return {
      ids: rows.map(({ testId }) => testId),
      total: counts[0]?.count ?? 0,
    };
  }

  async getPublishedStringFilterOptions(): Promise<{
    skills: string[];
    abilityTags: string[];
  }> {
    const queryValues = (column: 'skills' | 'ability_tags') =>
      this.prisma.$queryRaw<StringValueRow[]>(Prisma.sql`
        SELECT DISTINCT values."value"
        FROM "catalog_test_projections" p
        INNER JOIN "catalog_benchmark_projections" b
          ON b."benchmark_id" = p."benchmark_id"
        INNER JOIN "catalog_entries" ce ON ce."test_id" = p."test_id"
        CROSS JOIN LATERAL unnest(${Prisma.raw(`p."${column}"`)}) AS values("value")
        WHERE p."deleted_at" IS NULL
          AND p."snapshot" IS NOT NULL
          AND p."name" IS NOT NULL
          AND p."name_en" IS NOT NULL
          AND p."source_created_at" IS NOT NULL
          AND b."deleted_at" IS NULL
          AND b."name" IS NOT NULL
          AND ce."status" = ${BenchmarkValidationStatus.published}::"BenchmarkValidationStatus"
          AND ce."archived_at" IS NULL
        ORDER BY values."value" ASC
      `);

    const [skills, abilityTags] = await this.prisma.$transaction([
      queryValues('skills'),
      queryValues('ability_tags'),
    ]);
    return {
      skills: skills.map(({ value }) => value),
      abilityTags: abilityTags.map(({ value }) => value),
    };
  }

  async selectGroupSuites(
    query: CatalogQueryDto
  ): Promise<{ suites: ProjectionGroupSuite[]; total: number }> {
    const totalTestsWhere = Prisma.join(
      this.buildWhere(
        { page: 1, limit: 1 },
        BenchmarkTestReadScope.Public
      ),
      ' AND '
    );
    const matchedTestsWhere = this.groupTestWhere(query);
    const visibilityJoin = Prisma.sql`
      INNER JOIN "catalog_entries" ce ON ce."test_id" = p."test_id"
    `;
    const page = query.page ?? 1;
    const limit = query.limit ?? 1000;
    const skip = (page - 1) * limit;
    const activeSuite = Prisma.sql`
      b."deleted_at" IS NULL
      AND b."name" IS NOT NULL
      AND b."name_en" IS NOT NULL
      AND b."source_created_at" IS NOT NULL
    `;

    const [suites, counts] = await this.prisma.$transaction([
      this.prisma.$queryRaw<ProjectionGroupSuite[]>(Prisma.sql`
        WITH candidates AS (
          SELECT
            b."benchmark_id" AS "id",
            b."name" AS "name",
            b."name_en" AS "nameEn",
            b."description" AS "description",
            b."description_en" AS "descriptionEn",
            (
              SELECT COUNT(*)::INTEGER
              FROM "catalog_test_projections" p
              ${visibilityJoin}
              WHERE p."benchmark_id" = b."benchmark_id"
                AND ${totalTestsWhere}
            ) AS "benchmarkTestsCount",
            (
              SELECT COUNT(*)::INTEGER
              FROM "catalog_test_projections" p
              ${visibilityJoin}
              WHERE p."benchmark_id" = b."benchmark_id"
                AND ${matchedTestsWhere}
            ) AS "matchedTestsCount",
            b."source_created_at" AS "sourceCreatedAt"
          FROM "catalog_benchmark_projections" b
          WHERE ${activeSuite}
        )
        SELECT
          "id",
          "name",
          "nameEn",
          "description",
          "descriptionEn",
          "benchmarkTestsCount",
          "matchedTestsCount"
        FROM candidates
        WHERE "matchedTestsCount" > 0
        ORDER BY "sourceCreatedAt" DESC, "id" ASC
        OFFSET ${skip}
        LIMIT ${limit}
      `),
      this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::INTEGER AS "count"
        FROM "catalog_benchmark_projections" b
        WHERE ${activeSuite}
          AND EXISTS (
            SELECT 1
            FROM "catalog_test_projections" p
            ${visibilityJoin}
            WHERE p."benchmark_id" = b."benchmark_id"
              AND ${matchedTestsWhere}
          )
      `),
    ]);

    return { suites, total: counts[0]?.count ?? 0 };
  }

  async selectGroupTestIds(
    query: CatalogQueryDto,
    suiteIds: string[]
  ): Promise<string[]> {
    const matchedTestsWhere = this.groupTestWhere(query);
    const rows = await this.prisma.$queryRaw<ProjectionIdRow[]>(Prisma.sql`
      SELECT p."test_id" AS "testId"
      FROM "catalog_test_projections" p
      INNER JOIN "catalog_benchmark_projections" b
        ON b."benchmark_id" = p."benchmark_id"
      INNER JOIN "catalog_entries" ce ON ce."test_id" = p."test_id"
      WHERE p."benchmark_id" IN (${Prisma.join(suiteIds)})
        AND ${matchedTestsWhere}
      ORDER BY p."source_created_at" DESC, p."test_id" ASC
    `);
    return rows.map(({ testId }) => testId);
  }

  private groupTestWhere(query: CatalogQueryDto): Prisma.Sql {
    const noSearchQuery = { ...query, search: undefined };
    const withoutSearch = Prisma.join(
      this.buildWhere(noSearchQuery, BenchmarkTestReadScope.Public),
      ' AND '
    );
    if (!query.search) return withoutSearch;

    const withSearch = Prisma.join(
      this.buildWhere(query, BenchmarkTestReadScope.Public),
      ' AND '
    );
    const search = `%${this.escapeLike(query.search)}%`;
    const suiteMatches = Prisma.sql`(
      b."name" ILIKE ${search} OR b."name_en" ILIKE ${search}
    )`;
    return Prisma.sql`(
      (${suiteMatches} AND ${withoutSearch})
      OR (NOT ${suiteMatches} AND ${withSearch})
    )`;
  }

  private buildWhere(
    query: BenchmarkTestQueryDto,
    scope: BenchmarkTestReadScope,
    testId?: string
  ): Prisma.Sql[] {
    const clauses: Prisma.Sql[] = [
      Prisma.sql`p."deleted_at" IS NULL`,
      Prisma.sql`p."snapshot" IS NOT NULL`,
      Prisma.sql`p."name" IS NOT NULL`,
      Prisma.sql`p."name_en" IS NOT NULL`,
      Prisma.sql`p."benchmark_id" IS NOT NULL`,
      Prisma.sql`p."source_created_at" IS NOT NULL`,
      Prisma.sql`b."deleted_at" IS NULL`,
      Prisma.sql`b."name" IS NOT NULL`,
    ];

    if (BenchmarkTestReadScope.Public === scope) {
      clauses.push(
        Prisma.sql`ce."status" = ${BenchmarkValidationStatus.published}::"BenchmarkValidationStatus"`,
        Prisma.sql`ce."archived_at" IS NULL`
      );
    }
    if (testId) clauses.push(Prisma.sql`p."test_id" = ${testId}`);
    this.addScalarFilter(clauses, 'p."benchmark_id"', query.suiteIds);
    this.addScalarFilter(clauses, 'p."macro_group_id"', query.macroGroupIds);
    this.addScalarFilter(clauses, 'p."language_id"', query.languageIds);
    this.addScalarFilter(clauses, 'p."difficulty_id"', query.difficultyIds);
    this.addScalarFilter(clauses, 'p."task_type_id"', query.taskTypeIds);
    this.addArrayFilter(clauses, 'p."sub_group_ids"', query.subGroupIds, 'UUID');
    this.addArrayFilter(
      clauses,
      'p."ability_taxon_ids"',
      query.abilityTaxonIds,
      'UUID'
    );
    this.addArrayFilter(clauses, 'p."domain_ids"', query.domainIds, 'UUID');
    this.addArrayFilter(
      clauses,
      'p."subdomain_ids"',
      query.subdomainIds,
      'UUID'
    );
    this.addArrayFilter(clauses, 'p."modality_ids"', query.modalityIds, 'UUID');
    this.addArrayFilter(
      clauses,
      'p."capability_ids"',
      query.capabilityIds,
      'UUID'
    );
    this.addArrayFilter(
      clauses,
      'p."ability_tags"',
      query.abilityTags,
      'VARCHAR(255)'
    );
    this.addArrayFilter(clauses, 'p."skills"', query.skills, 'VARCHAR(255)');

    if (query.sizeMin !== undefined) {
      clauses.push(Prisma.sql`p."size_in_samples" >= ${query.sizeMin}`);
    }
    if (query.sizeMax !== undefined) {
      clauses.push(Prisma.sql`p."size_in_samples" <= ${query.sizeMax}`);
    }
    if (query.search) {
      const search = `%${this.escapeLike(query.search)}%`;
      clauses.push(Prisma.sql`(
        p."name" ILIKE ${search}
        OR p."name_en" ILIKE ${search}
        OR p."description" ILIKE ${search}
        OR p."description_en" ILIKE ${search}
        OR p."short_description" ILIKE ${search}
        OR p."task_description" ILIKE ${search}
        OR b."name" ILIKE ${search}
        OR b."name_en" ILIKE ${search}
      )`);
    }

    return clauses;
  }

  private addScalarFilter(
    clauses: Prisma.Sql[],
    column: string,
    values?: string[]
  ): void {
    if (!values?.length) return;
    clauses.push(
      Prisma.sql`${Prisma.raw(column)} IN (${Prisma.join(values)})`
    );
  }

  private addArrayFilter(
    clauses: Prisma.Sql[],
    column: string,
    values: string[] | undefined,
    sqlType: 'UUID' | 'VARCHAR(255)'
  ): void {
    if (!values?.length) return;
    clauses.push(
      Prisma.sql`${Prisma.raw(column)} && ARRAY[${Prisma.join(values)}]::${Prisma.raw(sqlType)}[]`
    );
  }

  private buildOrderBy(query: BenchmarkTestQueryDto): Prisma.Sql {
    const direction =
      SortDirection.Asc === query.sortDirection
        ? Prisma.raw('ASC')
        : Prisma.raw('DESC');

    switch (query.sortColumn) {
      case BenchmarkSortColumn.Name:
        return Prisma.sql`p."name" ${direction} NULLS LAST, p."test_id" ASC`;
      case BenchmarkSortColumn.SizeInSamples:
        return Prisma.sql`p."size_in_samples" ${direction} NULLS LAST, p."test_id" ASC`;
      case BenchmarkSortColumn.Difficulty:
        return Prisma.sql`difficulty."name" ${direction} NULLS LAST, p."test_id" ASC`;
      case BenchmarkSortColumn.Language:
        return Prisma.sql`language."name" ${direction} NULLS LAST, p."test_id" ASC`;
      case BenchmarkSortColumn.CreatedAt:
      default:
        return Prisma.sql`p."source_created_at" ${direction} NULLS LAST, p."test_id" ASC`;
    }
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, '\\$&');
  }
}
