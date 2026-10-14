import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { BenchmarkController } from '@/catalog/benchmark/benchmark.controller';
import { BenchmarkTestController } from '@/catalog/benchmark-test/benchmark-test.controller';
import { CatalogEntryController } from '@/catalog/catalog-entry/catalog-entry.controller';
import { CatalogController } from '@/catalog/catalog-view/catalog.controller';
import { CatalogModule } from '@/catalog/catalog.module';
import { BenchmarkCatalogBridgeModule } from '../benchmark-catalog-bridge.module';

describe('Catalog to Benchmark Service boundary', () => {
  it('owns Benchmark and Test endpoints, while Catalogue owns listing/moderation', () => {
    const benchmarkControllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      BenchmarkCatalogBridgeModule
    ) as unknown[];
    const catalogControllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      CatalogModule
    ) as unknown[];

    expect(benchmarkControllers).toEqual([BenchmarkController, BenchmarkTestController]);
    expect(catalogControllers).toEqual([CatalogController, CatalogEntryController]);
  });

  it('keeps transport contracts independent from Nest, Prisma and Catalog', () => {
    const source = readSource('src/benchmark-service/contracts/benchmark-integration.v1.ts');

    expect(source).not.toMatch(/from ['"]@nestjs\//);
    expect(source).not.toMatch(/generated\/prisma|@prisma\/client/);
    expect(source).not.toMatch(/from ['"].*catalog\//);
  });

  it('keeps projection-facing Test types independent from legacy persistence', () => {
    const sources = [
      readSource('src/catalog/benchmark/types.ts'),
      readSource('src/catalog/benchmark-test/types.ts'),
      readSource('src/catalog/benchmark-test/benchmark-test-read-scope.ts'),
    ];

    for (const source of sources) {
      expect(source).not.toMatch(/generated\/prisma|@prisma\/client/);
      expect(source).not.toMatch(/legacy-benchmark-test|repository/);
    }
  });

  it('keeps the target write path away from legacy Benchmark tables', () => {
    const sources = [
      readSource(
        'src/benchmark-service/integration/benchmark-remote-write.service.ts'
      ),
      readSource(
        'src/benchmark-service/integration/benchmark-command-outbox.service.ts'
      ),
    ];

    expect(sources[0]).toContain('BenchmarkCommandOutboxService');
    expect(sources[0]).toContain('catalogBenchmarkProjection');
    expect(sources[0]).toContain('catalogTestProjection');
    for (const source of sources) {
      expect(source).not.toMatch(/\.benchmark\.(create|update|delete|upsert)/);
      expect(source).not.toMatch(
        /\.benchmarkTest\.(create|update|delete|upsert)/
      );
      expect(source).not.toMatch(
        /BenchmarkTestIntegrationSource|import \{ Benchmark,/
      );
    }
  });

  it('keeps the Benchmark suite facade away from legacy persistence details', () => {
    const source = readSource('src/catalog/benchmark/benchmark.service.ts');

    expect(source).not.toMatch(/generated\/prisma|PrismaService/);
    expect(source).not.toMatch(/IBenchmarkRepository|BenchmarkMapper/);
    expect(source).not.toMatch(/IBenchmarkChangeNotifier/);
    expect(source).not.toMatch(/legacy\/legacy-benchmark/);
  });

  it('keeps the Benchmark Test facade away from legacy persistence details', () => {
    const source = readSource(
      'src/catalog/benchmark-test/benchmark-test.service.ts'
    );

    expect(source).not.toMatch(/PrismaService|PrismaClientKnownRequestError/);
    expect(source).not.toMatch(/IBenchmarkTestRepository|BenchmarkTestMapper/);
    expect(source).not.toMatch(/IBenchmarkChangeNotifier/);
    expect(source).not.toMatch(/legacy\/legacy-benchmark/);
  });

  it('keeps projection reads independent from legacy Benchmark tables', () => {
    const sources = [
      readSource('src/catalog/projection/catalog-benchmark-projection-query.service.ts'),
      readSource('src/catalog/projection/catalog-test-projection-query.service.ts'),
      readSource('src/catalog/projection/catalog-test-projection-sql.repository.ts'),
      readSource('src/catalog/projection/catalog-test-projection-hydrator.service.ts'),
    ];

    for (const source of sources) {
      expect(source).not.toMatch(/prisma\.benchmark(?:Test)?\b/);
      expect(source).not.toMatch(/BenchmarkTestRepository|BenchmarkRepository/);
    }
  });

  it('does not register legacy data migration in the application runtime', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      BenchmarkCatalogBridgeModule
    ) as unknown[];
    const exports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      BenchmarkCatalogBridgeModule
    ) as unknown[];

    expect(
      [...providers, ...exports].map((provider) =>
        'function' === typeof provider ? provider.name : ''
      )
    ).not.toContain('BenchmarkEventsBackfillService');
  });

  it('has no runtime cutover switches or conditional legacy providers', () => {
    const sources = [
      readSource('src/configs/kafka.config.ts'),
      readSource('src/configs/types.ts'),
      readSource('src/benchmark-service/benchmark-catalog-bridge.module.ts'),
      readSource('src/catalog/catalog.module.ts'),
    ];

    for (const source of sources) {
      expect(source).not.toMatch(
        /BENCHMARK_SERVICE_(READ|WRITE)_MODE|benchmark(Read|Write)Mode/
      );
      expect(source).not.toMatch(/legacy[A-Z].*ProvidersFor/);
    }
  });

  it('does not own Benchmark source aggregates in the Catalog schema', () => {
    const schema = [
      readSource('prisma/models/catalog.prisma'),
      readSource('prisma/models/metrics.prisma'),
    ].join('\n');

    expect(schema).not.toMatch(/model\s+Benchmark(?:Test)?\s*\{/);
    expect(schema).not.toMatch(/model\s+DatasetSubsample\s*\{/);
    expect(schema).not.toMatch(/@@map\("(?:benchmarks|benchmark_tests|dataset_subsamples)"\)/);
  });

  it('keeps readiness checks on Catalog projections', () => {
    const source = readSource('src/health/health.service.ts');

    expect(source).toContain('catalog_test_projections');
    expect(source).toContain('catalog_benchmark_projections');
    expect(source).not.toMatch(/FROM "benchmark_tests"|JOIN "benchmarks"/);
  });

  it('keeps Settings handlers away from legacy Test persistence', () => {
    const handlers = [
      'macro-groups',
      'sub-groups',
      'ability-taxons',
      'task-types',
      'modalities',
      'languages',
      'difficulties',
      'capabilities',
      'domains',
      'subdomains',
    ];

    for (const handler of handlers) {
      const source = readSource(
        `src/catalog/settings/handlers/${handler}.handler.ts`
      );
      expect(source).not.toMatch(/prisma\.benchmarkTest/);
      expect(source).not.toContain('ACTIVE_TEST_FILTER');
    }
  });

  it('keeps the Catalog entry runtime workflow away from legacy Test persistence', () => {
    const source = readSource(
      'src/catalog/catalog-entry/catalog-entry.service.ts'
    );

    expect(source).not.toMatch(/prisma\.benchmarkTest/);
    expect(source).not.toMatch(/legacy-benchmark-test/);
    expect(source).not.toMatch(/BenchmarkTestMapper/);
  });

  it('keeps the Metrics repository away from legacy Test persistence', () => {
    const source = readSource('src/metrics/repositories/metrics.repository.ts');

    expect(source).not.toMatch(/prisma\.benchmarkTest/);
    expect(source).not.toMatch(/benchmarkTests:\s*true/);
  });

  it('keeps the Analytics repository away from legacy Benchmark persistence', () => {
    const source = readSource(
      'src/analytics/repository/analytics.repository.ts'
    );

    expect(source).not.toMatch(/prisma\.benchmark(?:Test)?/);
    expect(source).not.toContain('benchmarkReadMode');
  });

  it('keeps recommendation completion away from legacy Test persistence', () => {
    const source = readSource(
      'src/recommendations/repository/recommendation-requests.repository.ts'
    );

    expect(source).not.toMatch(/transaction\.benchmarkTest/);
    expect(source).not.toContain('benchmarkReadMode');
  });

  it('keeps the search runtime and source contract away from legacy tables', () => {
    const sources = [
      readSource('src/catalog/search/benchmark-search.repository.ts'),
      readSource('src/catalog/search/types.ts'),
    ];

    for (const source of sources) {
      expect(source).not.toMatch(/prisma\.benchmarkTest/);
      expect(source).not.toMatch(/"benchmark_tests"|"benchmarks"/);
      expect(source).not.toMatch(/BenchmarkTestGetPayload|BenchmarkTestSelect/);
    }
  });

  it('keeps the external API runtime away from legacy Test persistence', () => {
    const source = readSource(
      'src/external-api/benchmark-tests/external-benchmark-tests.service.ts'
    );
    const types = readSource(
      'src/external-api/benchmark-tests/types.ts'
    );

    expect(source).not.toMatch(/prisma\.benchmarkTest/);
    expect(source).not.toMatch(/generated\/prisma|PrismaService/);
    expect(source).not.toMatch(/ExternalBenchmarkTestsMapper/);
    expect(types).not.toMatch(/generated\/prisma|BenchmarkTestGetPayload/);
  });
});

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}
