import { Module } from '@nestjs/common';
import { CatalogProjectionReadModule } from '@/catalog/projection/catalog-projection-read.module';
import { MetricsModule } from '@/metrics/metrics.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { VaultModule } from '@/vault/vault.module';
import { ExternalApiKeysController } from './api-keys/external-api-keys.controller';
import { ExternalApiKeysService } from './api-keys/external-api-keys.service';
import { ExternalApiKeyGuard } from './api-keys/guards/external-api-key.guard';
import { ExternalBenchmarkTestsProjectionService } from './benchmark-tests/external-benchmark-tests-projection.service';
import { ExternalBenchmarkTestsController } from './benchmark-tests/external-benchmark-tests.controller';
import { ExternalBenchmarkTestsService } from './benchmark-tests/external-benchmark-tests.service';
import { ExternalMetricResultsController } from './metric-results/external-metric-results.controller';
import { ExternalMetricsController } from './metrics/external-metrics.controller';
import { ExternalModelsController } from './models/external-models.controller';

@Module({
  imports: [
    PrismaModule,
    VaultModule,
    MetricsModule,
    CatalogProjectionReadModule,
  ],
  controllers: [
    ExternalApiKeysController,
    ExternalBenchmarkTestsController,
    ExternalMetricsController,
    ExternalModelsController,
    ExternalMetricResultsController,
  ],
  providers: [
    ExternalApiKeysService,
    ExternalBenchmarkTestsService,
    ExternalBenchmarkTestsProjectionService,
    ExternalApiKeyGuard,
  ],
  exports: [
    ExternalApiKeysService,
    ExternalBenchmarkTestsService,
  ],
})
export class ExternalApiModule {}
