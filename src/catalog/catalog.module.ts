import { Module } from '@nestjs/common';
import { BenchmarkCatalogBridgeModule } from '@/benchmark-service/benchmark-catalog-bridge.module';
import { KafkaModule } from '@/kafka/kafka.module';
import { CatalogEntryController } from './catalog-entry/catalog-entry.controller';
import { CatalogEntryService } from './catalog-entry/catalog-entry.service';
import { CatalogController } from './catalog-view/catalog.controller';
import { CatalogService } from './catalog-view/catalog.service';
import { CatalogBenchmarkEventsConsumer } from './projection/catalog-benchmark-events.consumer';
import { CatalogBenchmarkProjectionService } from './projection/catalog-benchmark-projection.service';
import { BenchmarkSearchModule } from './search/benchmark-search.module';

@Module({
  imports: [BenchmarkCatalogBridgeModule, BenchmarkSearchModule, KafkaModule],
  controllers: [
    CatalogController,
    CatalogEntryController,
  ],
  providers: [
    CatalogEntryService,
    CatalogService,
    CatalogBenchmarkProjectionService,
    CatalogBenchmarkEventsConsumer,
  ],
  exports: [
    CatalogService,
    BenchmarkSearchModule,
    CatalogBenchmarkProjectionService,
  ],
})
export class CatalogModule {}
