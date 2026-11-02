import { Injectable } from '@nestjs/common';
import { pendingTestReferences } from '@/benchmark-service/integration/benchmark-command-outbox.service';
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import type { MetricUsage } from './metrics.repository.interface';

export type MetricResultTarget = {
  id: string;
  benchmarkId: string;
  aggregateVersion: number;
  metricIds: string[];
};

@Injectable()
export class MetricsTestReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async findMetricUsageById(id: string): Promise<Nullable<MetricUsage>> {
    const metric = await this.prisma.metricDefinition.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!metric) return null;

    const [assignments, results] = await this.prisma.$transaction([
      this.prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
        SELECT COUNT(*)::INTEGER AS count
        FROM (
          SELECT test_id::TEXT FROM catalog_test_projections
          WHERE ${metric.id}::UUID = ANY(metric_ids)
          UNION
          SELECT test_id FROM (${pendingTestReferences('metricIds')}) pending
          WHERE pending.id = ${metric.id}
        ) references_used
      `),
      this.prisma.metricResult.count({ where: { metricId: id } }),
    ]);
    return { testAssignments: assignments[0].count, results };
  }

  async findActiveTestTarget(
    testId: string,
    client: Prisma.TransactionClient = this.prisma
  ): Promise<MetricResultTarget | null> {
    const test = await client.catalogTestProjection.findFirst({
      where: {
        testId: testId.toLowerCase(),
        benchmarkId: { not: null },
        deletedAt: null,
        snapshot: { not: Prisma.DbNull },
        sourceCreatedAt: { not: null },
      },
      select: {
        testId: true,
        benchmarkId: true,
        aggregateVersion: true,
        metricIds: true,
      },
    });
    if (!test?.benchmarkId) return null;

    const suite = await client.catalogBenchmarkProjection.findFirst({
      where: {
        benchmarkId: test.benchmarkId,
        deletedAt: null,
        name: { not: null },
        nameEn: { not: null },
        sourceCreatedAt: { not: null },
      },
      select: { benchmarkId: true },
    });
    if (!suite) return null;

    return {
      id: test.testId,
      benchmarkId: test.benchmarkId,
      aggregateVersion: test.aggregateVersion,
      metricIds: test.metricIds,
    };
  }

}
