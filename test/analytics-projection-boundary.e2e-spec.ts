import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AnalyticsService } from '@/analytics/analytics.service';
import { PrismaService } from '@/prisma/prisma.service';
import { E2E_ORIGIN } from './support/auth';
import { createE2eApplication } from './support/create-e2e-application';

describe('Analytics benchmark-service boundary (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let analytics: AnalyticsService;
  const benchmarkId = '11111111-1111-4111-8111-111111111111';
  const otherBenchmarkId = '22222222-2222-4222-8222-222222222222';
  const testId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const deletedTestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
    analytics = app.get(AnalyticsService);
  });

  beforeEach(async () => {
    await clearFixtures();
    const sourceCreatedAt = new Date('2026-09-12T08:00:00.000Z');
    const sourceUpdatedAt = new Date('2026-09-12T09:00:00.000Z');

    await prisma.catalogBenchmarkProjection.createMany({
      data: [
        {
          benchmarkId,
          aggregateVersion: 1,
          name: 'Remote Benchmark',
          nameEn: 'Remote Benchmark EN',
          sourceCreatedAt,
          sourceUpdatedAt,
        },
        {
          benchmarkId: otherBenchmarkId,
          aggregateVersion: 1,
          name: 'Other Benchmark',
          nameEn: 'Other Benchmark EN',
          sourceCreatedAt,
          sourceUpdatedAt,
        },
      ],
    });
    await prisma.catalogTestProjection.createMany({
      data: [
        testProjection(testId, benchmarkId, sourceCreatedAt, sourceUpdatedAt),
        {
          ...testProjection(
            deletedTestId,
            benchmarkId,
            sourceCreatedAt,
            sourceUpdatedAt
          ),
          deletedAt: new Date('2026-09-12T10:00:00.000Z'),
        },
      ],
    });
  });

  afterAll(async () => {
    await clearFixtures();
    await app.close();
  });

  it('tracks and hydrates a remote Test from projections', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/analytics/benchmark-views')
      .set('Origin', E2E_ORIGIN)
      .set('User-Agent', 'projection-boundary-test')
      .send({
        benchmarkId,
        benchmarkTestId: testId,
        sessionId: 'anonymous-session',
        metadata: { source: 'catalog-card' },
      })
      .expect(201);

    expect(response.body).toMatchObject({
      type: 'benchmark_test_view',
      benchmarkId,
      benchmarkTestId: testId,
    });

    const topBenchmarks = await analytics.getTopBenchmarks({ limit: 10 });
    expect(topBenchmarks).toEqual([
      {
        benchmarkId,
        name: 'Remote Benchmark',
        nameEn: 'Remote Benchmark EN',
        views: 1,
      },
    ]);

    const topTests = await analytics.getTopBenchmarkTests({ limit: 10 });
    expect(topTests).toEqual([
      {
        benchmarkTestId: testId,
        benchmarkId,
        name: `Remote Test ${testId}`,
        nameEn: `Remote Test ${testId} EN`,
        benchmarkName: 'Remote Benchmark',
        benchmarkNameEn: 'Remote Benchmark EN',
        views: 1,
      },
    ]);

    const events = await analytics.getEvents({
      page: 1,
      limit: 10,
      benchmarkTestId: testId,
    });
    expect(events).toMatchObject({
      total: 1,
      data: [
        {
          benchmark: {
            id: benchmarkId,
            name: 'Remote Benchmark',
            nameEn: 'Remote Benchmark EN',
          },
          benchmarkTest: {
            id: testId,
            benchmarkId,
            name: `Remote Test ${testId}`,
            nameEn: `Remote Test ${testId} EN`,
          },
        },
      ],
    });
  });

  it('keeps ownership and active-state validation on projection data', async () => {
    await request(app.getHttpServer())
      .post('/api/analytics/benchmark-views')
      .set('Origin', E2E_ORIGIN)
      .send({ benchmarkId: otherBenchmarkId, benchmarkTestId: testId })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/analytics/benchmark-views')
      .set('Origin', E2E_ORIGIN)
      .send({ benchmarkId, benchmarkTestId: deletedTestId })
      .expect(404);

    await request(app.getHttpServer())
      .post('/api/analytics/benchmark-views')
      .set('Origin', E2E_ORIGIN)
      .send({ benchmarkId: 'missing-benchmark' })
      .expect(404);

    await expect(prisma.analyticsEvent.count()).resolves.toBe(0);
  });

  it('retains historical events after remote projections disappear', async () => {
    await request(app.getHttpServer())
      .post('/api/analytics/benchmark-views')
      .set('Origin', E2E_ORIGIN)
      .send({ benchmarkId })
      .expect(201);

    await prisma.catalogTestProjection.deleteMany();
    await prisma.catalogBenchmarkProjection.deleteMany();

    await expect(
      prisma.analyticsEvent.findFirstOrThrow({ where: { benchmarkId } })
    ).resolves.toMatchObject({
      type: 'benchmark_view',
      benchmarkId,
      benchmarkTestId: null,
    });
  });

  async function clearFixtures(): Promise<void> {
    await prisma.analyticsEvent.deleteMany();
    await prisma.catalogTestProjection.deleteMany();
    await prisma.catalogBenchmarkProjection.deleteMany();
    await prisma.catalogEntry.deleteMany();
  }
});

function testProjection(
  testId: string,
  benchmarkId: string,
  sourceCreatedAt: Date,
  sourceUpdatedAt: Date
) {
  return {
    testId,
    benchmarkId,
    aggregateVersion: 1,
    snapshot: { id: testId },
    name: `Remote Test ${testId}`,
    nameEn: `Remote Test ${testId} EN`,
    sourceCreatedAt,
    sourceUpdatedAt,
  };
}
