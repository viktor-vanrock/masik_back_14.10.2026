import { Injectable } from '@nestjs/common';
import { InfiniteDataResponseType } from '@/common/types/infiniteDataResponse.type';
import { BenchmarkTestReadScope } from '../benchmark-test/benchmark-test-read-scope';
import { BenchmarkTestQueryDto } from '../benchmark-test/dto/benchmarkTestQuery.dto';
import { BenchmarkType } from '../benchmark-test/types';
import { CatalogSubmissionQueryDto } from '../catalog-entry/dto/catalog-submission-query.dto';
import { CatalogQueryDto } from '../catalog-view/dto/catalogQuery.dto';
import { BenchmarkGroupType } from '../catalog-view/types';
import { CatalogTestProjectionHydrator } from './catalog-test-projection-hydrator.service';
import { CatalogTestProjectionSqlRepository } from './catalog-test-projection-sql.repository';

@Injectable()
export class CatalogTestProjectionQueryService {
  constructor(
    private readonly queries: CatalogTestProjectionSqlRepository,
    private readonly hydrator: CatalogTestProjectionHydrator
  ) {}

  async findAll(
    query: BenchmarkTestQueryDto,
    scope: BenchmarkTestReadScope
  ): Promise<InfiniteDataResponseType<BenchmarkType>> {
    const { ids, total } = await this.queries.selectIds(query, scope);
    return {
      data: await this.hydrator.hydrate(ids, scope),
      total,
    };
  }

  async findById(
    testId: string,
    scope: BenchmarkTestReadScope
  ): Promise<BenchmarkType | null> {
    const { ids } = await this.queries.selectIds(
      { page: 1, limit: 1 },
      scope,
      testId
    );
    const [test] = await this.hydrator.hydrate(ids, scope);
    return test ?? null;
  }

  async findOwnedSubmissions(
    query: CatalogSubmissionQueryDto,
    authorId: string
  ): Promise<InfiniteDataResponseType<BenchmarkType>> {
    const { ids, total } = await this.queries.selectOwnedSubmissionIds(
      query,
      authorId
    );
    return {
      data: await this.hydrator.hydrate(
        ids,
        BenchmarkTestReadScope.Management
      ),
      total,
    };
  }

  getPublishedStringFilterOptions(): Promise<{
    skills: string[];
    abilityTags: string[];
  }> {
    return this.queries.getPublishedStringFilterOptions();
  }

  async findGrouped(
    query: CatalogQueryDto
  ): Promise<InfiniteDataResponseType<BenchmarkGroupType>> {
    const { suites, total } = await this.queries.selectGroupSuites(query);
    if (!suites.length) return { data: [], total };

    const testIds = await this.queries.selectGroupTestIds(
      query,
      suites.map(({ id }) => id)
    );
    const tests = await this.hydrator.hydrate(
      testIds,
      BenchmarkTestReadScope.Public
    );
    const testsBySuite = new Map<string, BenchmarkType[]>();
    for (const test of tests) {
      if (!test.suiteId) continue;
      const bucket = testsBySuite.get(test.suiteId) ?? [];
      bucket.push(test);
      testsBySuite.set(test.suiteId, bucket);
    }

    return {
      data: suites.map((suite) => ({
        benchmark: suite,
        tests: testsBySuite.get(suite.id) ?? [],
      })),
      total,
    };
  }
}
