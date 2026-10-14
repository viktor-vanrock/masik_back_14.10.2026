import { InfiniteDataResponseType } from '@/common/types/infiniteDataResponse.type';
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

export abstract class IAnalyticsRepository {
  abstract createEvent(data: AnalyticsCreateEventType): Promise<AnalyticsCreatedEventType>;

  abstract findActiveBenchmark(
    id: string
  ): Promise<Nullable<{ id: string; name: string; nameEn: string }>>;

  abstract findActiveBenchmarkTest(
    id: string
  ): Promise<
    Nullable<{
      id: string;
      benchmarkId: string;
      name: string;
      nameEn: string;
    }>
  >;

  abstract countEvents(period: AnalyticsPeriodType): Promise<number>;

  abstract countByType(
    period: AnalyticsPeriodType,
    types: AnalyticsEventType[]
  ): Promise<number>;

  abstract countUniqueSessions(period: AnalyticsPeriodType): Promise<number>;

  abstract findEventsByDay(
    period: AnalyticsPeriodType
  ): Promise<AnalyticsCounterByDayType[]>;

  abstract findTopBenchmarks(
    period: AnalyticsPeriodType,
    limit: number
  ): Promise<BenchmarkViewsStatType[]>;

  abstract findTopBenchmarkTests(
    period: AnalyticsPeriodType,
    limit: number
  ): Promise<BenchmarkTestViewsStatType[]>;

  abstract findEvents(
    query: AnalyticsEventsQueryDto,
    period: AnalyticsPeriodType
  ): Promise<InfiniteDataResponseType<unknown>>;
}
