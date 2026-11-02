import { Module } from '@nestjs/common';
import { BenchmarkController } from '@/catalog/benchmark/benchmark.controller';
import { BenchmarkService } from '@/catalog/benchmark/benchmark.service';
import { BenchmarkTestController } from '@/catalog/benchmark-test/benchmark-test.controller';
import { BenchmarkTestService } from '@/catalog/benchmark-test/benchmark-test.service';
import { CatalogProjectionReadModule } from '@/catalog/projection/catalog-projection-read.module';
import { BenchmarkSearchModule } from '@/catalog/search/benchmark-search.module';
import { SettingsModule } from '@/catalog/settings/settings.module';
import { BenchmarkIntegrationModule } from './integration/benchmark-integration.module';

@Module({
  imports: [
    SettingsModule,
    CatalogProjectionReadModule,
    BenchmarkSearchModule,
    BenchmarkIntegrationModule,
  ],
  controllers: [BenchmarkController, BenchmarkTestController],
  providers: [BenchmarkService, BenchmarkTestService],
  exports: [
    BenchmarkService,
    BenchmarkTestService,
    CatalogProjectionReadModule,
    BenchmarkIntegrationModule,
    SettingsModule,
  ],
})
export class BenchmarkCatalogBridgeModule {}
