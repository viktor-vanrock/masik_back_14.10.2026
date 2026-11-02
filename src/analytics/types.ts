import { AnalyticsEventType } from './analytics-event-type.enum';

export type AnalyticsPeriodType = {
  from: Date;
  to: Date;
};

export type AnalyticsTrackingContextType = {
  userId?: string;
  sessionId?: string;
  ip?: string;
  userAgent?: string;
};

export type AnalyticsCreateEventType = {
  type: AnalyticsEventType;
  benchmarkId?: string;
  benchmarkTestId?: string;
  userId?: string;
  sessionIdHash?: string;
  ipHash?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  eventDate: Date;
};

export type AnalyticsCreatedEventType = {
  id: string;
  type: AnalyticsEventType;
  benchmarkId: string | null;
  benchmarkTestId: string | null;
  createdAt: Date;
};

export type AnalyticsCounterByDayType = {
  date: string;
  type: AnalyticsEventType;
  count: number;
};

export type BenchmarkViewsStatType = {
  benchmarkId: string;
  name: string | null;
  nameEn: string | null;
  views: number;
};

export type BenchmarkTestViewsStatType = {
  benchmarkTestId: string;
  benchmarkId: string | null;
  name: string | null;
  nameEn: string | null;
  benchmarkName: string | null;
  benchmarkNameEn: string | null;
  views: number;
};

export type AnalyticsOverviewType = {
  period: {
    from: string;
    to: string;
  };
  totalEvents: number;
  totalViews: number;
  benchmarkViews: number;
  benchmarkTestViews: number;
  catalogSearches: number;
  filterUsageEvents: number;
  uniqueSessions: number;
  topBenchmarks: BenchmarkViewsStatType[];
  topBenchmarkTests: BenchmarkTestViewsStatType[];
  eventsByDay: AnalyticsCounterByDayType[];
};
