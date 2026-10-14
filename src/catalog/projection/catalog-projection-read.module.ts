import { Module } from '@nestjs/common';
import { CatalogBenchmarkProjectionQueryService } from './catalog-benchmark-projection-query.service';
import { CatalogTestProjectionHydrator } from './catalog-test-projection-hydrator.service';
import { CatalogTestProjectionQueryService } from './catalog-test-projection-query.service';
import { CatalogTestProjectionSqlRepository } from './catalog-test-projection-sql.repository';

@Module({
  providers: [
    CatalogBenchmarkProjectionQueryService,
    CatalogTestProjectionHydrator,
    CatalogTestProjectionQueryService,
    CatalogTestProjectionSqlRepository,
  ],
  exports: [
    CatalogBenchmarkProjectionQueryService,
    CatalogTestProjectionHydrator,
    CatalogTestProjectionQueryService,
    CatalogTestProjectionSqlRepository,
  ],
})
export class CatalogProjectionReadModule {}
