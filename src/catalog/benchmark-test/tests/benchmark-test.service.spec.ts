import { NotFoundException } from '@nestjs/common';
import { BenchmarkRemoteWriteService } from '@/benchmark-service/integration/benchmark-remote-write.service';
import { CatalogTestProjectionQueryService } from '@/catalog/projection/catalog-test-projection-query.service';
import { SettingsAggregateService } from '@/catalog/settings/settings-aggregate.service';
import { BenchmarkTestReadScope } from '../benchmark-test-read-scope';
import { BenchmarkTestService } from '../benchmark-test.service';

describe('BenchmarkTestService', () => {
  const projection = {
    findAll: jest.fn(),
    findById: jest.fn(),
    getPublishedStringFilterOptions: jest.fn(),
  };
  const remoteWrites = {
    createTest: jest.fn(),
    updateTest: jest.fn(),
    restoreTest: jest.fn(),
    deleteTest: jest.fn(),
  };
  const settings = { getAll: jest.fn() };
  const service = new BenchmarkTestService(
    projection as unknown as CatalogTestProjectionQueryService,
    remoteWrites as unknown as BenchmarkRemoteWriteService,
    settings as unknown as SettingsAggregateService
  );

  beforeEach(() => jest.clearAllMocks());

  it('uses separate public and management projection scopes', async () => {
    const page = { data: [{ id: 'test-id' }], total: 1 };
    projection.findAll.mockResolvedValue(page);

    await expect(
      service.findAllBenchmark({ page: 1, limit: 20 })
    ).resolves.toBe(page);
    await expect(
      service.findAllForManagement({ page: 1, limit: 20 })
    ).resolves.toBe(page);
    expect(projection.findAll).toHaveBeenNthCalledWith(
      1,
      { page: 1, limit: 20 },
      BenchmarkTestReadScope.Public
    );
    expect(projection.findAll).toHaveBeenNthCalledWith(
      2,
      { page: 1, limit: 20 },
      BenchmarkTestReadScope.Management
    );
  });

  it('keeps public and management not-found behavior', async () => {
    projection.findById.mockResolvedValue(null);
    await expect(
      service.findPublishedBenchmarkById('missing')
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.findBenchmarkById('missing')).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('normalizes set-like fields before sending Kafka commands', async () => {
    const receipt = { status: 'queued', operationId: 'operation-id' };
    remoteWrites.createTest.mockResolvedValue(receipt);
    remoteWrites.updateTest.mockResolvedValue(receipt);

    await service.createBenchmark({
      suiteId: '11111111-1111-4111-8111-111111111111',
      name: 'Тест',
      nameEn: 'Test',
      description: 'Description',
      metrics: [' accuracy ', '', 'accuracy', ' f1 '],
      domainIds: ['domain-a', 'domain-a'],
    });
    await service.updateBenchmarkById('test-id', {
      skills: ['math', 'math'],
    });

    expect(remoteWrites.createTest).toHaveBeenCalledWith(
      expect.objectContaining({
        metrics: ['accuracy', 'f1'],
        domainIds: ['domain-a'],
      }),
      undefined
    );
    expect(remoteWrites.updateTest).toHaveBeenCalledWith(
      'test-id',
      expect.objectContaining({ skills: ['math'] })
    );
  });

  it('merges taxonomy dictionaries with projected string filters', async () => {
    settings.getAll.mockResolvedValue({
      taxonomy: { macroGroups: [], subGroups: [], abilityTaxons: [] },
      parameters: {
        taskTypes: [],
        modalities: [],
        languages: [],
        difficulties: [],
        capabilities: [],
      },
      domains: { domains: [], subdomains: [] },
    });
    projection.getPublishedStringFilterOptions.mockResolvedValue({
      skills: ['reasoning'],
      abilityTags: ['math'],
    });

    await expect(service.getFilterOptions()).resolves.toMatchObject({
      skills: ['reasoning'],
      abilityTags: ['math'],
    });
  });
});
