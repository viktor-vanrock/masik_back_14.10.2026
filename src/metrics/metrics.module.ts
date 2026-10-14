import { Module } from '@nestjs/common';
import { BenchmarkIntegrationModule } from '@/benchmark-service/integration/benchmark-integration.module';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { metricsRepositoryProvider } from './repositories/metrics-repository.provider';
import { MetricsTestReferenceService } from './repositories/metrics-test-reference.service';

@Module({
  imports: [BenchmarkIntegrationModule],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    MetricsTestReferenceService,
    metricsRepositoryProvider,
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
