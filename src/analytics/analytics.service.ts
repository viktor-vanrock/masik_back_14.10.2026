import { createHash } from 'crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AnalyticsEventType } from './analytics-event-type.enum';
import { AnalyticsDateRangeQueryDto } from './dto/analytics-date-range-query.dto';
import { AnalyticsEventsQueryDto } from './dto/analytics-events-query.dto';
import { AnalyticsTopQueryDto } from './dto/analytics-top-query.dto';
import { TrackBenchmarkViewDto } from './dto/track-benchmark-view.dto';
import { TrackCatalogEventDto } from './dto/track-catalog-event.dto';
import {
  IAnalyticsRepository,
} from './repository/analytics.repository.interface';
import {
  AnalyticsCreatedEventType,
  AnalyticsOverviewType,
  AnalyticsPeriodType,
  AnalyticsTrackingContextType,
} from './types';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly hashSalt =
    process.env.ANALYTICS_HASH_SALT ||
    process.env.JWT_ACCESS_SECRET ||
    'benchmark-catalog-analytics';

  constructor(
    @Inject(IAnalyticsRepository)
    private readonly analyticsRepository: IAnalyticsRepository
  ) {}

  async trackBenchmarkView(
    dto: TrackBenchmarkViewDto,
    context: AnalyticsTrackingContextType
  ): Promise<AnalyticsCreatedEventType> {
    const benchmark = await this.analyticsRepository.findActiveBenchmark(
      dto.benchmarkId
    );

    if (!benchmark) {
      throw new NotFoundException(
        `Benchmark with id "${dto.benchmarkId}" was not found`
      );
    }

    let benchmarkTestId: string | undefined;
    let type: AnalyticsEventType = AnalyticsEventType.BenchmarkView;

    if (dto.benchmarkTestId) {
      const benchmarkTest =
        await this.analyticsRepository.findActiveBenchmarkTest(
          dto.benchmarkTestId
        );

      if (!benchmarkTest) {
        throw new NotFoundException(
          `BenchmarkTest with id "${dto.benchmarkTestId}" was not found`
        );
      }

      if (benchmarkTest.benchmarkId !== dto.benchmarkId) {
        throw new BadRequestException(
          `BenchmarkTest "${dto.benchmarkTestId}" does not belong to Benchmark "${dto.benchmarkId}"`
        );
      }

      benchmarkTestId = benchmarkTest.id;
      type = AnalyticsEventType.BenchmarkTestView;
    }

    const now = new Date();

    const event = await this.analyticsRepository.createEvent({
      type,
      benchmarkId: benchmark.id,
      benchmarkTestId,
      userId: context.userId,
      sessionIdHash: this.hashNullable(context.sessionId),
      ipHash: this.hashNullable(context.ip),
      userAgent: this.truncate(context.userAgent, 1000),
      metadata: dto.metadata ?? {},
      eventDate: this.toDateOnly(now),
    });

    this.logger.debug(
      `Analytics event tracked: id="${event.id}", type="${event.type}"`
    );

    return event;
  }

  async trackCatalogEvent(
    dto: TrackCatalogEventDto,
    context: AnalyticsTrackingContextType
  ): Promise<AnalyticsCreatedEventType> {
    if (
      dto.type !== AnalyticsEventType.CatalogSearch &&
      dto.type !== AnalyticsEventType.FilterUsage
    ) {
      throw new BadRequestException(
        'Only catalog_search and filter_usage events can be tracked by this endpoint'
      );
    }

    const now = new Date();

    return this.analyticsRepository.createEvent({
      type: dto.type,
      userId: context.userId,
      sessionIdHash: this.hashNullable(context.sessionId),
      ipHash: this.hashNullable(context.ip),
      userAgent: this.truncate(context.userAgent, 1000),
      metadata: {
        ...(dto.metadata ?? {}),
        ...(dto.search ? { search: dto.search } : {}),
        ...(dto.filters ? { filters: dto.filters } : {}),
      },
      eventDate: this.toDateOnly(now),
    });
  }

  async getOverview(
    query: AnalyticsDateRangeQueryDto
  ): Promise<AnalyticsOverviewType> {
    const period = this.resolvePeriod(query);

    const [
      totalEvents,
      benchmarkViews,
      benchmarkTestViews,
      catalogSearches,
      filterUsageEvents,
      uniqueSessions,
      topBenchmarks,
      topBenchmarkTests,
      eventsByDay,
    ] = await Promise.all([
      this.analyticsRepository.countEvents(period),
      this.analyticsRepository.countByType(period, [
        AnalyticsEventType.BenchmarkView,
      ]),
      this.analyticsRepository.countByType(period, [
        AnalyticsEventType.BenchmarkTestView,
      ]),
      this.analyticsRepository.countByType(period, [
        AnalyticsEventType.CatalogSearch,
      ]),
      this.analyticsRepository.countByType(period, [
        AnalyticsEventType.FilterUsage,
      ]),
      this.analyticsRepository.countUniqueSessions(period),
      this.analyticsRepository.findTopBenchmarks(period, 5),
      this.analyticsRepository.findTopBenchmarkTests(period, 5),
      this.analyticsRepository.findEventsByDay(period),
    ]);

    return {
      period: {
        from: period.from.toISOString(),
        to: period.to.toISOString(),
      },
      totalEvents,
      totalViews: benchmarkViews + benchmarkTestViews,
      benchmarkViews,
      benchmarkTestViews,
      catalogSearches,
      filterUsageEvents,
      uniqueSessions,
      topBenchmarks,
      topBenchmarkTests,
      eventsByDay,
    };
  }

  async getTopBenchmarks(query: AnalyticsTopQueryDto) {
    const period = this.resolvePeriod(query);
    return this.analyticsRepository.findTopBenchmarks(period, query.limit);
  }

  async getTopBenchmarkTests(query: AnalyticsTopQueryDto) {
    const period = this.resolvePeriod(query);
    return this.analyticsRepository.findTopBenchmarkTests(period, query.limit);
  }

  async getEvents(query: AnalyticsEventsQueryDto) {
    const period = this.resolvePeriod(query);
    return this.analyticsRepository.findEvents(query, period);
  }

  resolvePeriod(query: AnalyticsDateRangeQueryDto): AnalyticsPeriodType {
    const to = query.to ? this.parseRangeDate(query.to, 'to') : new Date();
    const from = query.from
      ? this.parseRangeDate(query.from, 'from')
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

    if (from > to) {
      throw new BadRequestException('from must be less than or equal to to');
    }

    return { from, to };
  }

  private parseRangeDate(value: string, boundary: 'from' | 'to'): Date {
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`Invalid ${boundary} date`);
    }

    if (!isDateOnly) {
      return date;
    }

    if ('from' === boundary) {
      return new Date(`${value}T00:00:00.000Z`);
    }

    return new Date(`${value}T23:59:59.999Z`);
  }

  private toDateOnly(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    );
  }

  private hashNullable(value?: string): string | undefined {
    if (!value) return undefined;

    return createHash('sha256')
      .update(`${this.hashSalt}:${value}`)
      .digest('hex');
  }

  private truncate(value: string | undefined, max: number): string | undefined {
    if (!value) return undefined;
    return value.length > max ? value.slice(0, max) : value;
  }
}
