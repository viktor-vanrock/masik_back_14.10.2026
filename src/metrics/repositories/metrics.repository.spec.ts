import { SortDirection } from '@/common/enums/sortDirection.enum';
import { PrismaService } from '@/prisma/prisma.service';
import { MetricsTestReferenceService } from './metrics-test-reference.service';
import { MetricsRepository } from './metrics.repository';

describe('MetricsRepository', () => {
  const findMany = jest.fn();
  const count = jest.fn();
  const findTest = jest.fn();
  const findSuite = jest.fn();
  const createResult = jest.fn();
  const countResultsInTx = jest.fn();
  const advisoryLock = jest.fn();
  const transaction = jest.fn();
  const upsertModel = jest.fn();

  const tx = {
    catalogTestProjection: { findFirst: findTest },
    catalogBenchmarkProjection: { findFirst: findSuite },
    metricResult: {
      create: createResult,
      count: countResultsInTx,
    },
    $queryRaw: advisoryLock,
  };

  const prisma = {
    model: { upsert: upsertModel },
    catalogTestProjection: { findFirst: findTest },
    catalogBenchmarkProjection: { findFirst: findSuite },
    metricResult: {
      findMany,
      count,
    },
    $transaction: transaction,
  } as unknown as PrismaService;

  const benchmarkCommands = {
    lockTestWrites: jest.fn(),
    assertNoPendingTestMutation: jest.fn(),
    testSpecificationLocked: jest.fn(),
  };
  const testReferences = new MetricsTestReferenceService(prisma);
  const repository = new MetricsRepository(
    prisma,
    benchmarkCommands as any,
    testReferences
  );

  beforeEach(() => {
    jest.clearAllMocks();
    advisoryLock.mockResolvedValue([{ pg_advisory_xact_lock: null }]);
    countResultsInTx.mockResolvedValue(0);
    findSuite.mockResolvedValue({ benchmarkId: 'benchmark-suite' });

    transaction.mockImplementation(
      async (
        work:
          | Promise<unknown>[]
          | ((transactionClient: typeof tx) => Promise<unknown>)
      ) =>
        'function' === typeof work ? work(tx) : Promise.all(work)
    );
  });

  it('persists architecture and preserves it when an update omits architecture', async () => {
    let stored: Record<string, unknown> | undefined;
    upsertModel.mockImplementation(({ create, update }) => {
      const defined = Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined));
      stored = stored ? { ...stored, ...defined } : create;
      return stored;
    });
    await expect(repository.createModel({ id: 'diffusion', name: 'Diffusion', architecture: 'text-diffusion' }))
      .resolves.toMatchObject({ architecture: 'text-diffusion' });
    await expect(repository.createModel({ id: 'diffusion', name: 'Renamed' }))
      .resolves.toMatchObject({ name: 'Renamed', architecture: 'text-diffusion' });
    await expect(repository.createModel({ id: 'diffusion', name: 'Updated', architecture: 'omnimodal' }))
      .resolves.toMatchObject({ architecture: 'omnimodal' });
  });

  it('returns a paginated metric result response', async () => {
    const rows = [
      {
        id: 'result-id',
        testId: 'benchmark-test',
      },
    ];

    findMany.mockResolvedValue(rows);
    count.mockResolvedValue(11);

    await expect(
      repository.findMetricResultsByTestId('benchmark-test', {
        page: 2,
        limit: 10,
        sortColumn: 'value',
        sortDirection: SortDirection.Asc,
      })
    ).resolves.toEqual({
      data: rows,
      total: 11,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: { testId: 'benchmark-test' },
      orderBy: {
        value: 'asc',
      },
      skip: 10,
      take: 10,
      include: {
        metric: {
          include: {
            priority: true,
            direction: true,
          },
        },
        model: true,
      },
    });

    expect(count).toHaveBeenCalledWith({
      where: { testId: 'benchmark-test' },
    });
  });

  it('applies search and falls back to obtainedAt descending', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await repository.findMetricResultsByTestId('benchmark-test', {
      page: 1,
      limit: 20,
      search: 'accuracy',
      sortColumn: 'not-allowed',
      sortDirection: SortDirection.Desc,
    });

    const findManyCall = findMany.mock.calls[0][0];

    expect(findManyCall.skip).toBe(0);
    expect(findManyCall.take).toBe(20);
    expect(findManyCall.orderBy).toEqual({
      obtainedAt: 'desc',
    });
    expect(findManyCall.where.testId).toBe('benchmark-test');
    expect(findManyCall.where).not.toHaveProperty('subsetId');
    expect(findManyCall.where.OR).toEqual(
      expect.arrayContaining([
        {
          modelId: {
            contains: 'accuracy',
            mode: 'insensitive',
          },
        },
        {
          metric: {
            name: {
              contains: 'accuracy',
              mode: 'insensitive',
            },
          },
        },
      ])
    );
  });

  it('creates the first MetricResult and its Test lock command in one transaction', async () => {
    const test = {
      testId: 'benchmark-test',
      benchmarkId: 'benchmark-suite',
      aggregateVersion: 5,
      metricIds: ['33333333-3333-4333-8333-333333333333'],
    };
    const created = { id: '44444444-4444-4444-8444-444444444444' };
    findTest.mockResolvedValue(test);
    createResult.mockResolvedValue(created);

    await expect(
      repository.createMetricResult({
        testId: test.testId,
        metricId: test.metricIds[0],
        modelId: 'model-id',
        value: 0.91,
      })
    ).resolves.toBe(created);

    expect(transaction).toHaveBeenCalledWith(expect.any(Function));
    expect(benchmarkCommands.lockTestWrites).toHaveBeenCalledWith(tx, test.testId);
    expect(benchmarkCommands.assertNoPendingTestMutation).toHaveBeenCalledWith(tx, test.testId);
    expect(createResult).toHaveBeenCalledTimes(1);
    expect(benchmarkCommands.testSpecificationLocked).toHaveBeenCalledWith(
      tx,
      {
        id: test.testId,
        benchmarkId: test.benchmarkId,
        aggregateVersion: test.aggregateVersion,
        metricIds: test.metricIds,
      },
      created.id
    );
  });

  it('does not enqueue another Test lock after the first MetricResult', async () => {
    const test = {
      testId: 'benchmark-test',
      benchmarkId: 'benchmark-suite',
      aggregateVersion: 6,
      metricIds: ['33333333-3333-4333-8333-333333333333'],
    };
    findTest.mockResolvedValue(test);
    countResultsInTx.mockResolvedValue(1);
    createResult.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
    });

    await repository.createMetricResult({
      testId: test.testId,
      metricId: test.metricIds[0],
      modelId: 'model-id',
      value: 0.92,
    });

    expect(benchmarkCommands.testSpecificationLocked).not.toHaveBeenCalled();
  });

  it('fails the MetricResult transaction when the lock command cannot be persisted', async () => {
    const test = {
      testId: 'benchmark-test',
      benchmarkId: 'benchmark-suite',
      aggregateVersion: 5,
      metricIds: ['33333333-3333-4333-8333-333333333333'],
    };
    findTest.mockResolvedValue(test);
    createResult.mockResolvedValue({
      id: '66666666-6666-4666-8666-666666666666',
    });
    benchmarkCommands.testSpecificationLocked.mockRejectedValueOnce(
      new Error('outbox unavailable')
    );

    await expect(
      repository.createMetricResult({
        testId: test.testId,
        metricId: test.metricIds[0],
        modelId: 'model-id',
        value: 0.93,
      })
    ).rejects.toThrow('outbox unavailable');
  });

  it('counts Metric usage from projections', async () => {
    const findMetric = jest.fn().mockResolvedValue({ id: 'metric-id' });
    const countAssignments = jest.fn().mockResolvedValue([{ count: 3 }]);
    const countMetricResults = jest.fn().mockResolvedValue(4);
    const projectionPrisma = {
      metricDefinition: { findUnique: findMetric },
      $queryRaw: countAssignments,
      metricResult: { count: countMetricResults },
      $transaction: jest
        .fn()
        .mockImplementation((queries: Promise<unknown>[]) =>
          Promise.all(queries)
        ),
    } as unknown as PrismaService;
    const projectionRepository = new MetricsRepository(
      projectionPrisma,
      benchmarkCommands as any,
      new MetricsTestReferenceService(projectionPrisma)
    );

    await expect(
      projectionRepository.findMetricUsageById('metric-id')
    ).resolves.toEqual({ testAssignments: 3, results: 4 });
    expect(findMetric).toHaveBeenCalledWith({
      where: { id: 'metric-id' },
      select: { id: true },
    });
    expect(countAssignments).toHaveBeenCalledTimes(1);
    expect(countMetricResults).toHaveBeenCalledWith({
      where: { metricId: 'metric-id' },
    });
  });
});
