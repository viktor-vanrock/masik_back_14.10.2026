import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  MetricDefinition,
  MetricResult,
  Prisma,
} from '@/generated/prisma/client';
import { CreateMetricDefinitionDto } from '../dto/create-metric-definition.dto';
import { CreateMetricResultDto } from '../dto/create-metric-result.dto';
import { MetricsService } from '../metrics.service';

describe('MetricsService', () => {
  const repository = {
    findAllMetrics: jest.fn(),
    findMetricById: jest.fn(),
    findMetricByName: jest.fn(),
    createMetric: jest.fn(),
    updateMetricById: jest.fn(),
    deleteMetricById: jest.fn(),
    findMetricUsageById: jest.fn(),
    existsPriority: jest.fn(),
    existsDirection: jest.fn(),
    findAllPriorities: jest.fn(),
    findAllDirections: jest.fn(),
    ensureDefaultLookups: jest.fn(),
    createModel: jest.fn(),
    findAllModels: jest.fn(),
    findModelById: jest.fn(),
    createMetricResult: jest.fn(),
    isPublishedTest: jest.fn(),
    findMetricResultsByTestId: jest.fn(),
  };
  const service = new MetricsService(repository);

  const metric = (
    overrides: Record<string, unknown> = {}
  ): MetricDefinition =>
    ({
      id: 'metric-id',
      name: 'accuracy',
      displayName: 'Accuracy',
      priorityId: 'priority-id',
      directionId: 'direction-id',
      minValue: 0,
      maxValue: 1,
      targetValue: 0.9,
      evaluationLogic: 'legacy metric logic',
      requiredGigaChatQualityLevel: 'legacy quality',
      metadata: {},
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    }) as unknown as MetricDefinition;

  const createDto: CreateMetricDefinitionDto = {
    name: 'accuracy',
    priorityId: 'priority-id',
    directionId: 'direction-id',
    minValue: 0,
    maxValue: 1,
  };

  const resultDto: CreateMetricResultDto = {
    testId: 'test-id',
    metricId: 'metric-id',
    modelId: 'model-id',
    value: 0.95,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    repository.existsPriority.mockResolvedValue(true);
    repository.existsDirection.mockResolvedValue(true);
    repository.findMetricByName.mockResolvedValue(null);
    repository.findMetricById.mockResolvedValue(metric());
    repository.findMetricUsageById.mockResolvedValue({
      testAssignments: 0,
      results: 0,
    });
    repository.findModelById.mockResolvedValue({ id: 'model-id' });
    repository.isPublishedTest.mockResolvedValue(true);
  });

  it('ensures required lookup rows during module initialization', async () => {
    repository.ensureDefaultLookups.mockResolvedValue(undefined);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(repository.ensureDefaultLookups).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown priority and direction references', async () => {
    repository.existsPriority.mockResolvedValueOnce(false);

    await expect(service.createMetric(createDto)).rejects.toThrow(
      'Metric priority with id "priority-id" was not found'
    );
    expect(repository.findMetricByName).not.toHaveBeenCalled();

    repository.existsPriority.mockResolvedValueOnce(true);
    repository.existsDirection.mockResolvedValueOnce(false);
    await expect(service.createMetric(createDto)).rejects.toThrow(
      'Metric direction with id "direction-id" was not found'
    );
  });

  it('rejects an inverted value range before checking uniqueness', async () => {
    await expect(
      service.createMetric({ ...createDto, minValue: 2, maxValue: 1 })
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.findMetricByName).not.toHaveBeenCalled();
  });

  it('rejects an existing metric name', async () => {
    repository.findMetricByName.mockResolvedValue(metric());

    await expect(service.createMetric(createDto)).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(repository.createMetric).not.toHaveBeenCalled();
  });

  it('creates a Metric and removes Test-owned legacy fields from its contract', async () => {
    repository.createMetric.mockResolvedValue(metric());

    await expect(service.createMetric(createDto)).resolves.toMatchObject({
      id: 'metric-id',
      name: 'accuracy',
    });
    const response = await service.createMetric(createDto);
    expect(response).not.toHaveProperty('evaluationLogic');
    expect(response).not.toHaveProperty('requiredGigaChatQualityLevel');
  });

  it('maps a concurrent create uniqueness race to a conflict', async () => {
    repository.createMetric.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      })
    );

    await expect(service.createMetric(createDto)).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it('maps metric lists and rejects a missing metric lookup', async () => {
    repository.findAllMetrics.mockResolvedValue({ data: [metric()], total: 1 });

    const query = { page: 1, limit: 20 };
    await expect(service.findAllMetrics(query)).resolves.toMatchObject({
      total: 1,
      data: [{ id: 'metric-id', name: 'accuracy' }],
    });
    expect((await service.findAllMetrics(query)).data[0]).not.toHaveProperty(
      'evaluationLogic'
    );

    repository.findMetricById.mockResolvedValueOnce(null);
    await expect(service.findMetricById('missing')).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('rejects update of a missing Metric or a name owned by another Metric', async () => {
    repository.findMetricById.mockResolvedValueOnce(null);
    await expect(
      service.updateMetricById('missing', { name: 'f1' })
    ).rejects.toBeInstanceOf(NotFoundException);

    repository.findMetricById.mockResolvedValueOnce(metric());
    repository.findMetricByName.mockResolvedValueOnce(
      metric({ id: 'another-metric', name: 'f1' })
    );
    await expect(
      service.updateMetricById('metric-id', { name: 'f1' })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows a no-op rename to the current Metric identity', async () => {
    const current = metric();
    repository.findMetricById.mockResolvedValue(current);
    repository.updateMetricById.mockResolvedValue(current);

    await expect(
      service.updateMetricById('metric-id', { name: 'accuracy' })
    ).resolves.toMatchObject({ id: 'metric-id' });
    expect(repository.findMetricByName).not.toHaveBeenCalled();
  });

  it('validates changed lookups and the effective mixed old/new value range', async () => {
    repository.findMetricById.mockResolvedValue(metric({ minValue: 0, maxValue: 1 }));
    repository.existsDirection.mockResolvedValueOnce(false);

    await expect(
      service.updateMetricById('metric-id', { directionId: 'missing-direction' })
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.updateMetricById('metric-id', { minValue: 2 })
    ).rejects.toThrow('minValue (2) must be <= maxValue (1)');
  });

  it('maps concurrent update races and preserves unrelated failures', async () => {
    repository.findMetricById.mockResolvedValue(metric());
    repository.updateMetricById
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        })
      )
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('missing record', {
          code: 'P2025',
          clientVersion: 'test',
        })
      )
      .mockRejectedValueOnce(new Error('database offline'));

    await expect(
      service.updateMetricById('metric-id', { displayName: 'new' })
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.updateMetricById('metric-id', { displayName: 'new' })
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.updateMetricById('metric-id', { displayName: 'new' })
    ).rejects.toThrow('database offline');
  });

  it('maps delete absence and a concurrent delete race to not found', async () => {
    repository.findMetricUsageById.mockResolvedValueOnce(null);
    await expect(service.deleteMetricById('missing')).rejects.toBeInstanceOf(
      NotFoundException
    );

    repository.deleteMetricById.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('missing record', {
        code: 'P2025',
        clientVersion: 'test',
      })
    );
    await expect(service.deleteMetricById('metric-id')).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('refuses to delete a Metric used by a Test or historical result', async () => {
    repository.findMetricUsageById.mockResolvedValueOnce({
      testAssignments: 1,
      results: 0,
    });
    await expect(service.deleteMetricById('metric-id')).rejects.toBeInstanceOf(
      ConflictException
    );

    repository.findMetricUsageById.mockResolvedValueOnce({
      testAssignments: 0,
      results: 2,
    });
    await expect(service.deleteMetricById('metric-id')).rejects.toBeInstanceOf(
      ConflictException
    );

    expect(repository.deleteMetricById).not.toHaveBeenCalled();
  });

  it('maps a concurrent Metric reference created during deletion to conflict', async () => {
    repository.deleteMetricById.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('foreign key constraint', {
        code: 'P2003',
        clientVersion: 'test',
      })
    );

    await expect(service.deleteMetricById('metric-id')).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it('deletes an existing Metric and delegates lookup/model operations', async () => {
    repository.deleteMetricById.mockResolvedValue(undefined);
    repository.findAllPriorities.mockResolvedValue([{ id: 'priority-id' }]);
    repository.findAllDirections.mockResolvedValue([{ id: 'direction-id' }]);
    repository.createModel.mockResolvedValue({ id: 'model-id' });
    repository.findAllModels.mockResolvedValue([{ id: 'model-id' }]);

    await expect(service.deleteMetricById('metric-id')).resolves.toBeUndefined();
    await expect(service.findAllPriorities()).resolves.toEqual([
      { id: 'priority-id' },
    ]);
    await expect(service.findAllDirections()).resolves.toEqual([
      { id: 'direction-id' },
    ]);
    await expect(
      service.createModel({ id: 'model-id', name: 'Model' })
    ).resolves.toEqual({ id: 'model-id' });
    await expect(service.findAllModels()).resolves.toEqual([{ id: 'model-id' }]);
  });

  it('stores human baseline on Test instead of accepting a synthetic Human model', async () => {
    await expect(
      service.createMetricResult({ ...resultDto, modelId: '  HuMaN  ' })
    ).rejects.toThrow('Human baseline must be stored on Test');

    expect(repository.findModelById).not.toHaveBeenCalled();
  });

  it('requires both the Model and Metric before writing a result', async () => {
    repository.findModelById.mockResolvedValueOnce(null);
    await expect(service.createMetricResult(resultDto)).rejects.toThrow(
      'Model with id "model-id" was not found'
    );
    expect(repository.createMetricResult).not.toHaveBeenCalled();

    repository.findModelById.mockResolvedValueOnce({ id: 'model-id' });
    repository.findMetricById.mockResolvedValueOnce(null);
    await expect(service.createMetricResult(resultDto)).rejects.toThrow(
      'Metric definition with id "metric-id" was not found'
    );
  });

  it('creates only a Test-level result and sanitizes its nested Metric contract', async () => {
    const stored = {
      id: 'result-id',
      ...resultDto,
      metric: metric(),
    } as unknown as MetricResult;
    repository.createMetricResult.mockResolvedValue(stored);

    const response = await service.createMetricResult(resultDto);

    expect(repository.createMetricResult).toHaveBeenCalledWith(resultDto);
    expect(response).not.toHaveProperty('subsetId');
    expect(
      (response as unknown as { metric: object }).metric
    ).not.toHaveProperty('evaluationLogic');
  });

  it('exposes results only for a published Test and sanitizes every nested Metric', async () => {
    repository.isPublishedTest.mockResolvedValueOnce(false);
    await expect(
      service.findMetricResultsByTestId('test-id', { page: 1, limit: 20 })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.findMetricResultsByTestId).not.toHaveBeenCalled();

    repository.isPublishedTest.mockResolvedValueOnce(true);
    repository.findMetricResultsByTestId.mockResolvedValue({
      data: [
        {
          id: 'result-id',
          metric: metric(),
        } as unknown as MetricResult,
      ],
      total: 1,
    });

    const response = await service.findMetricResultsByTestId('test-id', {
      page: 1,
      limit: 20,
    });
    expect(response.total).toBe(1);
    expect(
      (response.data[0] as unknown as { metric: object }).metric
    ).not.toHaveProperty('evaluationLogic');
  });
});
