import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AnalyticsEventType } from '../analytics-event-type.enum';
import { AnalyticsService } from '../analytics.service';

describe('AnalyticsService', () => {
  const repository = {
    createEvent: jest.fn(),
    findActiveBenchmark: jest.fn(),
    findActiveBenchmarkTest: jest.fn(),
    countEvents: jest.fn(),
    countByType: jest.fn(),
    countUniqueSessions: jest.fn(),
    findEventsByDay: jest.fn(),
    findTopBenchmarks: jest.fn(),
    findTopBenchmarkTests: jest.fn(),
    findEvents: jest.fn(),
  };
  const service = new AnalyticsService(repository);

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findActiveBenchmark.mockResolvedValue({
      id: 'benchmark-id',
      name: 'Benchmark',
      nameEn: 'Benchmark EN',
    });
    repository.findActiveBenchmarkTest.mockResolvedValue({
      id: 'test-id',
      benchmarkId: 'benchmark-id',
      name: 'Test',
      nameEn: 'Test EN',
    });
    repository.createEvent.mockImplementation(async (data) => ({
      id: 'event-id',
      type: data.type,
      benchmarkId: data.benchmarkId ?? null,
      benchmarkTestId: data.benchmarkTestId ?? null,
      createdAt: new Date('2026-09-12T10:00:00.000Z'),
    }));
  });

  it('rejects a view for an unknown Benchmark', async () => {
    repository.findActiveBenchmark.mockResolvedValue(null);

    await expect(
      service.trackBenchmarkView({ benchmarkId: 'missing' }, {})
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.createEvent).not.toHaveBeenCalled();
  });

  it('rejects an unknown Test and a Test from another Benchmark', async () => {
    repository.findActiveBenchmarkTest.mockResolvedValueOnce(null);
    await expect(
      service.trackBenchmarkView(
        { benchmarkId: 'benchmark-id', benchmarkTestId: 'missing-test' },
        {}
      )
    ).rejects.toBeInstanceOf(NotFoundException);

    repository.findActiveBenchmarkTest.mockResolvedValueOnce({
      id: 'foreign-test',
      benchmarkId: 'another-benchmark',
      name: 'Foreign',
      nameEn: 'Foreign',
    });
    await expect(
      service.trackBenchmarkView(
        { benchmarkId: 'benchmark-id', benchmarkTestId: 'foreign-test' },
        {}
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.createEvent).not.toHaveBeenCalled();
  });

  it('stores a Test view with hashed identifiers and bounded user agent', async () => {
    const longUserAgent = 'a'.repeat(1100);

    await expect(
      service.trackBenchmarkView(
        {
          benchmarkId: 'benchmark-id',
          benchmarkTestId: 'test-id',
          metadata: { source: 'card' },
        },
        {
          sessionId: 'raw-session',
          ip: '192.0.2.1',
          userAgent: longUserAgent,
        }
      )
    ).resolves.toMatchObject({
      type: AnalyticsEventType.BenchmarkTestView,
      benchmarkId: 'benchmark-id',
      benchmarkTestId: 'test-id',
    });

    expect(repository.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: AnalyticsEventType.BenchmarkTestView,
        benchmarkId: 'benchmark-id',
        benchmarkTestId: 'test-id',
        metadata: { source: 'card' },
        sessionIdHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        ipHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        userAgent: 'a'.repeat(1000),
        eventDate: expect.any(Date),
      })
    );
    expect(repository.createEvent.mock.calls[0][0].sessionIdHash).not.toContain(
      'raw-session'
    );
  });

  it('stores a suite-only view without a Test dimension', async () => {
    await service.trackBenchmarkView({ benchmarkId: 'benchmark-id' }, {});

    expect(repository.findActiveBenchmarkTest).not.toHaveBeenCalled();
    expect(repository.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: AnalyticsEventType.BenchmarkView,
        benchmarkId: 'benchmark-id',
        benchmarkTestId: undefined,
      })
    );
  });

  it('accepts only catalog event types and merges their context', async () => {
    await expect(
      service.trackCatalogEvent(
        {
          type: AnalyticsEventType.BenchmarkView as typeof AnalyticsEventType.CatalogSearch,
        },
        {}
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    await service.trackCatalogEvent(
      {
        type: AnalyticsEventType.CatalogSearch,
        search: 'reasoning',
        filters: { language: ['ru'] },
        metadata: { page: 'catalog' },
      },
      { sessionId: 'session' }
    );

    expect(repository.createEvent).toHaveBeenCalledTimes(1);
    expect(repository.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: AnalyticsEventType.CatalogSearch,
        metadata: {
          page: 'catalog',
          search: 'reasoning',
          filters: { language: ['ru'] },
        },
        sessionIdHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    );
  });

  it('normalizes date-only boundaries to the entire UTC day', () => {
    expect(
      service.resolvePeriod({ from: '2026-09-01', to: '2026-09-02' })
    ).toEqual({
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-09-02T23:59:59.999Z'),
    });
  });

  it('rejects invalid and reversed analytics periods', () => {
    expect(() => service.resolvePeriod({ from: 'not-a-date' })).toThrow(
      BadRequestException
    );
    expect(() =>
      service.resolvePeriod({
        from: '2026-09-03T00:00:00.000Z',
        to: '2026-09-02T00:00:00.000Z',
      })
    ).toThrow(BadRequestException);
  });
});
