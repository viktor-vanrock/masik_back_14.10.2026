import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '@/prisma/prisma.service';
import { createE2eApplication } from './support/create-e2e-application';

describe('Benchmark suite projection reads (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const newestId = '11111111-1111-4111-8111-111111111111';
  const oldestId = '22222222-2222-4222-8222-222222222222';
  const deletedId = '33333333-3333-4333-8333-333333333333';
  const incompleteId = '44444444-4444-4444-8444-444444444444';

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await clearFixtures();
    await prisma.catalogBenchmarkProjection.createMany({
      data: [
        {
          benchmarkId: newestId,
          aggregateVersion: 2,
          name: 'Zulu Suite',
          nameEn: 'Newest Suite',
          description: 'From Kafka projection',
          descriptionEn: null,
          sourceCreatedAt: new Date('2026-09-11T12:00:00.000Z'),
          sourceUpdatedAt: new Date('2026-09-11T13:00:00.000Z'),
        },
        {
          benchmarkId: oldestId,
          aggregateVersion: 1,
          name: 'Alpha Suite',
          nameEn: 'Oldest Suite',
          description: null,
          descriptionEn: 'Old description',
          sourceCreatedAt: new Date('2026-09-10T12:00:00.000Z'),
          sourceUpdatedAt: new Date('2026-09-10T12:00:00.000Z'),
        },
        {
          benchmarkId: deletedId,
          aggregateVersion: 3,
          name: 'Deleted Suite',
          nameEn: 'Deleted Suite',
          deletedAt: new Date('2026-09-11T14:00:00.000Z'),
          sourceCreatedAt: new Date('2026-09-09T12:00:00.000Z'),
          sourceUpdatedAt: new Date('2026-09-11T14:00:00.000Z'),
        },
        {
          benchmarkId: incompleteId,
          aggregateVersion: 1,
          sourceUpdatedAt: new Date('2026-09-11T15:00:00.000Z'),
        },
      ],
    });
    await prisma.catalogTestProjection.createMany({
      data: [
        testProjection('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', newestId),
        testProjection('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', newestId),
        testProjection('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', oldestId),
        {
          ...testProjection(
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
            newestId
          ),
          deletedAt: new Date('2026-09-11T14:00:00.000Z'),
        },
      ],
    });
  });

  afterAll(async () => {
    await clearFixtures();
    await app.close();
  });

  it('serves paginated suites and active Test counts from projections', async () => {
    const firstPage = await request(app.getHttpServer())
      .get('/api/benchmarks?page=1&limit=1')
      .expect(200);
    expect(firstPage.body).toEqual({
      data: [
        {
          id: newestId,
          name: 'Zulu Suite',
          nameEn: 'Newest Suite',
          description: 'From Kafka projection',
          descriptionEn: null,
          benchmarkTestsCount: 2,
          createdAt: '2026-09-11T12:00:00.000Z',
          updatedAt: '2026-09-11T13:00:00.000Z',
        },
      ],
      total: 2,
    });

    const detail = await request(app.getHttpServer())
      .get(`/api/benchmarks/${oldestId}`)
      .expect(200);
    expect(detail.body).toMatchObject({
      id: oldestId,
      benchmarkTestsCount: 1,
    });
  });

  it('supports search and options while hiding deleted and incomplete rows', async () => {
    const search = await request(app.getHttpServer())
      .get('/api/benchmarks?search=newest')
      .expect(200);
    expect(search.body).toMatchObject({
      total: 1,
      data: [{ id: newestId }],
    });

    const options = await request(app.getHttpServer())
      .get('/api/benchmarks/options')
      .expect(200);
    expect(options.body).toEqual([
      { id: oldestId, name: 'Alpha Suite', nameEn: 'Oldest Suite' },
      { id: newestId, name: 'Zulu Suite', nameEn: 'Newest Suite' },
    ]);

    await request(app.getHttpServer())
      .get(`/api/benchmarks/${deletedId}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/benchmarks/${incompleteId}`)
      .expect(404);
  });

  async function clearFixtures(): Promise<void> {
    await prisma.catalogTestProjection.deleteMany();
    await prisma.catalogBenchmarkProjection.deleteMany();
    await prisma.catalogEntry.deleteMany();
  }
});

function testProjection(testId: string, benchmarkId: string) {
  return {
    testId,
    benchmarkId,
    aggregateVersion: 1,
    snapshot: { id: testId },
    name: `Test ${testId}`,
    nameEn: `Test ${testId} EN`,
    sourceCreatedAt: new Date('2026-09-11T11:00:00.000Z'),
    sourceUpdatedAt: new Date('2026-09-11T12:00:00.000Z'),
  };
}
