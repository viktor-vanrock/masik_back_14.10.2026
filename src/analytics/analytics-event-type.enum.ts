export const AnalyticsEventType = {
  BenchmarkView: 'benchmark_view',
  BenchmarkTestView: 'benchmark_test_view',
  CatalogSearch: 'catalog_search',
  FilterUsage: 'filter_usage',
} as const;

export type AnalyticsEventType =
  (typeof AnalyticsEventType)[keyof typeof AnalyticsEventType];
