import { Injectable } from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

export type AnalyticsBenchmarkLabel = {
  id: string;
  name: string | null;
  nameEn: string | null;
};

export type AnalyticsTestLabel = AnalyticsBenchmarkLabel & {
  benchmarkId: string | null;
};

export type AnalyticsTestWithBenchmark = AnalyticsTestLabel & {
  benchmark: Nullable<Pick<AnalyticsBenchmarkLabel, 'name' | 'nameEn'>>;
};

@Injectable()
export class AnalyticsBenchmarkReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveBenchmark(
    id: string
  ): Promise<Nullable<{ id: string; name: string; nameEn: string }>> {
    const row = await this.prisma.catalogBenchmarkProjection.findFirst({
      where: {
        benchmarkId: id,
        deletedAt: null,
        name: { not: null },
        nameEn: { not: null },
        sourceCreatedAt: { not: null },
      },
      select: { benchmarkId: true, name: true, nameEn: true },
    });
    return row
      ? { id: row.benchmarkId, name: row.name!, nameEn: row.nameEn! }
      : null;
  }

  async findActiveBenchmarkTest(
    id: string
  ): Promise<
    Nullable<{
      id: string;
      benchmarkId: string;
      name: string;
      nameEn: string;
    }>
  > {
    const row = await this.prisma.catalogTestProjection.findFirst({
      where: {
        testId: id,
        benchmarkId: { not: null },
        deletedAt: null,
        snapshot: { not: Prisma.DbNull },
        name: { not: null },
        nameEn: { not: null },
        sourceCreatedAt: { not: null },
      },
      select: { testId: true, benchmarkId: true, name: true, nameEn: true },
    });
    return row
      ? {
        id: row.testId,
        benchmarkId: row.benchmarkId!,
        name: row.name!,
        nameEn: row.nameEn!,
      }
      : null;
  }

  async findBenchmarkLabels(ids: string[]): Promise<AnalyticsBenchmarkLabel[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.catalogBenchmarkProjection.findMany({
      where: { benchmarkId: { in: ids } },
      select: { benchmarkId: true, name: true, nameEn: true },
    });
    return rows.map((row) => ({
      id: row.benchmarkId,
      name: row.name,
      nameEn: row.nameEn,
    }));
  }

  async findTestLabels(ids: string[]): Promise<AnalyticsTestLabel[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.catalogTestProjection.findMany({
      where: { testId: { in: ids } },
      select: { testId: true, benchmarkId: true, name: true, nameEn: true },
    });
    return rows.map((row) => ({
      id: row.testId,
      benchmarkId: row.benchmarkId,
      name: row.name,
      nameEn: row.nameEn,
    }));
  }

  async findTestsWithBenchmarks(
    ids: string[]
  ): Promise<AnalyticsTestWithBenchmark[]> {
    const tests = await this.findTestLabels(ids);
    const benchmarkIds = tests
      .map((test) => test.benchmarkId)
      .filter((id): id is string => Boolean(id));
    const benchmarks = await this.findBenchmarkLabels(benchmarkIds);
    const benchmarkById = new Map(benchmarks.map((item) => [item.id, item]));
    return tests.map((test) => ({
      ...test,
      benchmarkId: test.benchmarkId ?? '',
      benchmark: test.benchmarkId
        ? (benchmarkById.get(test.benchmarkId) ?? null)
        : null,
    }));
  }

}
