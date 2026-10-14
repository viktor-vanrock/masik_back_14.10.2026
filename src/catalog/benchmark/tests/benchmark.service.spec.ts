import { NotFoundException } from '@nestjs/common';
import { BenchmarkRemoteWriteService } from '@/benchmark-service/integration/benchmark-remote-write.service';
import { CatalogBenchmarkProjectionQueryService } from '@/catalog/projection/catalog-benchmark-projection-query.service';
import { BenchmarkService } from '../benchmark.service';

describe('BenchmarkService', () => {
  const remoteWrites = {
    createSuite: jest.fn(),
    updateSuite: jest.fn(),
    restoreSuite: jest.fn(),
    deleteSuite: jest.fn(),
  };
  const projections = {
    findAll: jest.fn(),
    findOptions: jest.fn(),
    findById: jest.fn(),
  };
  const service = new BenchmarkService(
    remoteWrites as unknown as BenchmarkRemoteWriteService,
    projections as unknown as CatalogBenchmarkProjectionQueryService
  );

  beforeEach(() => jest.clearAllMocks());

  it('serves all reads exclusively from local Kafka projections', async () => {
    const page = { data: [{ id: 'benchmark-id' }], total: 1 };
    const options = [{ id: 'benchmark-id', name: 'Группа', nameEn: 'Suite' }];
    projections.findAll.mockResolvedValue(page);
    projections.findOptions.mockResolvedValue(options);
    projections.findById.mockResolvedValue(page.data[0]);

    await expect(service.findAll({ page: 1, limit: 20 })).resolves.toBe(page);
    await expect(service.findOptions()).resolves.toBe(options);
    await expect(service.findById('benchmark-id')).resolves.toBe(page.data[0]);
  });

  it('keeps the public not-found contract when the projection has no suite', async () => {
    projections.findById.mockResolvedValue(null);
    await expect(service.findById('missing')).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('sends every mutation through the Benchmark Kafka adapter', async () => {
    const receipt = { status: 'queued', operationId: 'operation-id' };
    remoteWrites.createSuite.mockResolvedValue(receipt);
    remoteWrites.updateSuite.mockResolvedValue(receipt);
    remoteWrites.restoreSuite.mockResolvedValue(receipt);
    remoteWrites.deleteSuite.mockResolvedValue(receipt);

    await expect(
      service.create({ name: 'Группа', nameEn: 'Suite' })
    ).resolves.toBe(receipt);
    await expect(
      service.updateById('benchmark-id', { description: 'new' })
    ).resolves.toBe(receipt);
    await expect(service.restoreById('benchmark-id')).resolves.toBe(receipt);
    await expect(service.softDeleteById('benchmark-id')).resolves.toBe(receipt);
  });
});
