import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsBenchmarkReferenceService } from './repository/analytics-benchmark-reference.service';
import { analyticsRepositoryProvider } from './repository/analytics.repository.provider';

@Module({
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    AnalyticsBenchmarkReferenceService,
    analyticsRepositoryProvider,
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
