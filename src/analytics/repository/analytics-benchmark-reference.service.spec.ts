import { PrismaService } from '@/prisma/prisma.service';
import { AnalyticsBenchmarkReferenceService } from './analytics-benchmark-reference.service';

describe('AnalyticsBenchmarkReferenceService', () => {
  const prisma = {
    catalogBenchmarkProjection: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    catalogTestProjection: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves active analytics targets from Catalog projections', async () => {
    prisma.catalogBenchmarkProjection.findFirst.mockResolvedValue({
      benchmarkId: 'suite-id',
      name: 'Группа',
      nameEn: 'Suite',
    });
    prisma.catalogTestProjection.findFirst.mockResolvedValue({
      testId: 'test-id',
      benchmarkId: 'suite-id',
      name: 'Тест',
      nameEn: 'Test',
    });
    const service = targetService(prisma);

    await expect(service.findActiveBenchmark('suite-id')).resolves.toEqual({
      id: 'suite-id',
      name: 'Группа',
      nameEn: 'Suite',
    });
    await expect(
      service.findActiveBenchmarkTest('test-id')
    ).resolves.toEqual({
      id: 'test-id',
      benchmarkId: 'suite-id',
      name: 'Тест',
      nameEn: 'Test',
    });
  });

  it('joins Test labels to suite labels without legacy tables', async () => {
    prisma.catalogTestProjection.findMany.mockResolvedValue([
      {
        testId: 'test-id',
        benchmarkId: 'suite-id',
        name: 'Тест',
        nameEn: 'Test',
      },
    ]);
    prisma.catalogBenchmarkProjection.findMany.mockResolvedValue([
      { benchmarkId: 'suite-id', name: 'Группа', nameEn: 'Suite' },
    ]);

    await expect(
      targetService(prisma).findTestsWithBenchmarks(['test-id'])
    ).resolves.toEqual([
      {
        id: 'test-id',
        benchmarkId: 'suite-id',
        name: 'Тест',
        nameEn: 'Test',
        benchmark: { id: 'suite-id', name: 'Группа', nameEn: 'Suite' },
      },
    ]);
  });

});

function targetService(prisma: object): AnalyticsBenchmarkReferenceService {
  return new AnalyticsBenchmarkReferenceService(prisma as PrismaService);
}
