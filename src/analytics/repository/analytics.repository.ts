import { Injectable } from '@nestjs/common';
import { InfiniteDataResponseType } from '@/common/types/infiniteDataResponse.type';
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AnalyticsEventType } from '../analytics-event-type.enum';
import { AnalyticsEventsQueryDto } from '../dto/analytics-events-query.dto';
import {
  AnalyticsCounterByDayType,
  AnalyticsCreateEventType,
  AnalyticsCreatedEventType,
  AnalyticsPeriodType,
  BenchmarkTestViewsStatType,
  BenchmarkViewsStatType,
} from '../types';
import { AnalyticsBenchmarkReferenceService } from './analytics-benchmark-reference.service';
import { IAnalyticsRepository } from './analytics.repository.interface';

@Injectable()
export class AnalyticsRepository implements IAnalyticsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly benchmarkReferences: AnalyticsBenchmarkReferenceService
  ) {}

  async createEvent(
    data: AnalyticsCreateEventType
  ): Promise<AnalyticsCreatedEventType> {
    return this.prisma.analyticsEvent.create({
      data: {
        type: data.type,
        benchmarkId: data.benchmarkId,
        benchmarkTestId: data.benchmarkTestId,
        userId: data.userId,
        sessionIdHash: data.sessionIdHash,
        ipHash: data.ipHash,
        userAgent: data.userAgent,
        metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
        eventDate: data.eventDate,
      },
      select: {
        id: true,
        type: true,
        benchmarkId: true,
        benchmarkTestId: true,
        createdAt: true,
      },
    });
  }

  async findActiveBenchmark(
    id: string
  ): Promise<Nullable<{ id: string; name: string; nameEn: string }>> {
    return this.benchmarkReferences.findActiveBenchmark(id);
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
    return this.benchmarkReferences.findActiveBenchmarkTest(id);
  }

  async countEvents(period: AnalyticsPeriodType): Promise<number> {
    return this.prisma.analyticsEvent.count({
      where: this.buildDateWhere(period),
    });
  }

  async countByType(
    period: AnalyticsPeriodType,
    types: AnalyticsEventType[]
  ): Promise<number> {
    return this.prisma.analyticsEvent.count({
      where: {
        ...this.buildDateWhere(period),
        type: { in: types },
      },
    });
  }

  async countUniqueSessions(period: AnalyticsPeriodType): Promise<number> {
    const rows = await this.prisma.analyticsEvent.findMany({
      where: {
        ...this.buildDateWhere(period),
        sessionIdHash: { not: null },
      },
      distinct: ['sessionIdHash'],
      select: { sessionIdHash: true },
    });

    return rows.length;
  }

  async findEventsByDay(
    period: AnalyticsPeriodType
  ): Promise<AnalyticsCounterByDayType[]> {
    const rows = await this.prisma.analyticsEvent.groupBy({
      by: ['eventDate', 'type'],
      where: this.buildDateWhere(period),
      _count: { _all: true },
      orderBy: [{ eventDate: 'asc' }, { type: 'asc' }],
    });

    return rows.map((row) => ({
      date: this.formatDateOnly(row.eventDate),
      type: row.type,
      count: row._count._all,
    }));
  }

  async findTopBenchmarks(
    period: AnalyticsPeriodType,
    limit: number
  ): Promise<BenchmarkViewsStatType[]> {
    const rows = await this.prisma.analyticsEvent.groupBy({
      by: ['benchmarkId'],
      where: {
        ...this.buildDateWhere(period),
        type: {
          in: [
            AnalyticsEventType.BenchmarkView,
            AnalyticsEventType.BenchmarkTestView,
          ],
        },
        benchmarkId: { not: null },
      },
      _count: { _all: true },
      orderBy: { _count: { id: 'desc' } },
      take: limit,
    });

    const benchmarkIds = rows
      .map((row) => row.benchmarkId)
      .filter((id): id is string => Boolean(id));

    const benchmarks = await this.benchmarkReferences.findBenchmarkLabels(
      benchmarkIds
    );

    const benchmarkById = new Map(
      benchmarks.map((benchmark) => [benchmark.id, benchmark])
    );

    return rows.map((row) => {
      const benchmark = row.benchmarkId
        ? benchmarkById.get(row.benchmarkId)
        : undefined;

      return {
        benchmarkId: row.benchmarkId ?? '',
        name: benchmark?.name ?? null,
        nameEn: benchmark?.nameEn ?? null,
        views: row._count._all,
      };
    });
  }

  async findTopBenchmarkTests(
    period: AnalyticsPeriodType,
    limit: number
  ): Promise<BenchmarkTestViewsStatType[]> {
    const rows = await this.prisma.analyticsEvent.groupBy({
      by: ['benchmarkTestId'],
      where: {
        ...this.buildDateWhere(period),
        type: AnalyticsEventType.BenchmarkTestView,
        benchmarkTestId: { not: null },
      },
      _count: { _all: true },
      orderBy: { _count: { id: 'desc' } },
      take: limit,
    });

    const testIds = rows
      .map((row) => row.benchmarkTestId)
      .filter((id): id is string => Boolean(id));

    const tests = await this.benchmarkReferences.findTestsWithBenchmarks(
      testIds
    );

    const testById = new Map(tests.map((test) => [test.id, test]));

    return rows.map((row) => {
      const test = row.benchmarkTestId
        ? testById.get(row.benchmarkTestId)
        : undefined;

      return {
        benchmarkTestId: row.benchmarkTestId ?? '',
        benchmarkId: test?.benchmarkId ?? null,
        name: test?.name ?? null,
        nameEn: test?.nameEn ?? null,
        benchmarkName: test?.benchmark?.name ?? null,
        benchmarkNameEn: test?.benchmark?.nameEn ?? null,
        views: row._count._all,
      };
    });
  }

  async findEvents(
    query: AnalyticsEventsQueryDto,
    period: AnalyticsPeriodType
  ): Promise<InfiniteDataResponseType<unknown>> {
    const where = this.buildEventListWhere(query, period);
    const skip = (query.page - 1) * query.limit;

    const [events, total] = await this.prisma.$transaction([
      this.prisma.analyticsEvent.findMany({
        where,
        select: {
          id: true,
          type: true,
          benchmarkId: true,
          benchmarkTestId: true,
          userId: true,
          sessionIdHash: true,
          ipHash: true,
          userAgent: true,
          metadata: true,
          eventDate: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: query.limit,
      }),
      this.prisma.analyticsEvent.count({ where }),
    ]);

    const benchmarkIds = events
      .map((event) => event.benchmarkId)
      .filter((id): id is string => Boolean(id));
    const testIds = events
      .map((event) => event.benchmarkTestId)
      .filter((id): id is string => Boolean(id));
    const [benchmarks, tests] = await Promise.all([
      this.benchmarkReferences.findBenchmarkLabels(benchmarkIds),
      this.benchmarkReferences.findTestLabels(testIds),
    ]);
    const benchmarkById = new Map(benchmarks.map((item) => [item.id, item]));
    const testById = new Map(tests.map((item) => [item.id, item]));
    const data = events.map((event) => ({
      ...event,
      benchmark: event.benchmarkId
        ? (benchmarkById.get(event.benchmarkId) ?? null)
        : null,
      benchmarkTest: event.benchmarkTestId
        ? (testById.get(event.benchmarkTestId) ?? null)
        : null,
    }));

    return { data, total };
  }

  private buildDateWhere(
    period: AnalyticsPeriodType
  ): Prisma.AnalyticsEventWhereInput {
    return {
      createdAt: {
        gte: period.from,
        lte: period.to,
      },
    };
  }

  private buildEventListWhere(
    query: AnalyticsEventsQueryDto,
    period: AnalyticsPeriodType
  ): Prisma.AnalyticsEventWhereInput {
    const where: Prisma.AnalyticsEventWhereInput = this.buildDateWhere(period);

    if (query.type) {
      where.type = query.type;
    }

    if (query.benchmarkId) {
      where.benchmarkId = query.benchmarkId;
    }

    if (query.benchmarkTestId) {
      where.benchmarkTestId = query.benchmarkTestId;
    }

    return where;
  }

  private formatDateOnly(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
