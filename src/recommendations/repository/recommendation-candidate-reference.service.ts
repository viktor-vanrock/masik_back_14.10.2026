import { Injectable } from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';

export type ActiveRecommendationCandidateVersion = {
  id: string;
  sourceUpdatedAt: Date;
};

@Injectable()
export class RecommendationCandidateReferenceService {
  async findActiveVersions(
    transaction: Prisma.TransactionClient,
    testIds: string[]
  ): Promise<ActiveRecommendationCandidateVersion[]> {
    if (!testIds.length) return [];
    const rows = await transaction.catalogTestProjection.findMany({
      where: {
        testId: { in: testIds },
        benchmarkId: { not: null },
        deletedAt: null,
        snapshot: { not: Prisma.DbNull },
        sourceCreatedAt: { not: null },
      },
      select: {
        testId: true,
        benchmarkId: true,
        sourceUpdatedAt: true,
      },
    });
    const suiteIds = [
      ...new Set(
        rows
          .map(({ benchmarkId }) => benchmarkId)
          .filter((id): id is string => Boolean(id))
      ),
    ];
    const suites = await transaction.catalogBenchmarkProjection.findMany({
      where: {
        benchmarkId: { in: suiteIds },
        deletedAt: null,
        name: { not: null },
        nameEn: { not: null },
        sourceCreatedAt: { not: null },
      },
      select: { benchmarkId: true },
    });
    const activeSuiteIds = new Set(
      suites.map(({ benchmarkId }) => benchmarkId)
    );
    return rows
      .filter(
        (row): row is typeof row & { benchmarkId: string } =>
          Boolean(row.benchmarkId && activeSuiteIds.has(row.benchmarkId))
      )
      .map(({ testId, sourceUpdatedAt }) => ({
        id: testId,
        sourceUpdatedAt,
      }));
  }

}
