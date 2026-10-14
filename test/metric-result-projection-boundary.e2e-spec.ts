import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BENCHMARK_MESSAGE_TYPES } from '@/benchmark-service/contracts/benchmark-integration.v1';
import { Role } from '@/common/enums/role.enum';
import { BenchmarkValidationStatus } from '@/generated/prisma/client';
import { KAFKA_TOPICS } from '@/kafka/kafka.constants';
import { PrismaService } from '@/prisma/prisma.service';
import { createAuthCookie, E2E_ORIGIN } from './support/auth';
import { createE2eApplication } from './support/create-e2e-application';

describe('MetricResult benchmark-service boundary (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie: string;
  const benchmarkId = '11111111-1111-4111-8111-111111111111';
  const testId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const modelId = 'Remote-Result-Model';
  const sourceCreatedAt = new Date('2026-09-12T08:00:00.000Z');
  const sourceUpdatedAt = new Date('2026-09-12T09:00:00.000Z');

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
    adminCookie = await createAuthCookie(app, Role.Admin);
  });

  beforeEach(async () => {
    await clearFixtures();
  });

  afterAll(async () => {
    await clearFixtures();
    await app.close();
  });

  it('creates and exposes Test-level results using remote projections', async () => {
    const metricId = await seedPublishedProjection();

    const created = await createResult(metricId, 0.91).expect(201);

    expect(created.body).toMatchObject({
      benchmarkId,
      testId,
      metricId,
      modelId,
      value: '0.91',
    });
    expect(created.body).not.toHaveProperty('test');

    const response = await request(app.getHttpServer())
      .get(`/api/metrics/tests/${testId}/results`)
      .query({ page: 1, limit: 20 })
      .expect(200);

    expect(response.body).toMatchObject({
      total: 1,
      data: [{ id: created.body.id, benchmarkId, testId, metricId, modelId }],
    });
    await expect(lockCommandCount()).resolves.toBe(1);
  });

  it('validates assignment and the active remote Test hierarchy', async () => {
    const assignedMetricId = await seedPublishedProjection();
    const foreignMetricId = await seedMetric('foreign-projection-metric');

    await createResult(foreignMetricId, 0.5).expect(400);

    await prisma.catalogTestProjection.update({
      where: { testId },
      data: { deletedAt: new Date('2026-09-12T10:00:00.000Z') },
    });
    await createResult(assignedMetricId, 0.6).expect(404);

    await prisma.catalogTestProjection.update({
      where: { testId },
      data: { deletedAt: null },
    });
    await prisma.catalogBenchmarkProjection.update({
      where: { benchmarkId },
      data: { deletedAt: new Date('2026-09-12T10:01:00.000Z') },
    });
    await createResult(assignedMetricId, 0.7).expect(404);

    await expect(prisma.metricResult.count()).resolves.toBe(0);
    await expect(lockCommandCount()).resolves.toBe(0);
  });

  it('serializes concurrent first results and queues exactly one lock command', async () => {
    const metricId = await seedPublishedProjection();

    const responses = await Promise.all([
      createResult(metricId, 0.81),
      createResult(metricId, 0.82),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([201, 201]);
    await expect(
      prisma.metricResult.count({ where: { testId } })
    ).resolves.toBe(2);
    await expect(lockCommandCount()).resolves.toBe(1);
  });

  it('uses one Test identity for results regardless of UUID letter case', async () => {
    const metricId = await seedPublishedProjection();
    const responses = await Promise.all([
      createResult(metricId, 0.81),
      request(app.getHttpServer())
        .post('/api/metrics/results')
        .set('Origin', E2E_ORIGIN)
        .set('Cookie', adminCookie)
        .send({ testId: testId.toUpperCase(), metricId: metricId.toUpperCase(), modelId, value: 0.82 }),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([201, 201]);
    expect(responses[1].body).toMatchObject({ testId, metricId, modelId });
    await expect(lockCommandCount()).resolves.toBe(1);
    await request(app.getHttpServer())
      .get(`/api/metrics/tests/${testId.toUpperCase()}/results`)
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({
        total: 2, data: [expect.objectContaining({ testId }), expect.objectContaining({ testId })],
      }));
  });

  it('retains result history after remote source projections disappear', async () => {
    const metricId = await seedPublishedProjection();
    const created = await createResult(metricId, 0.73).expect(201);

    await prisma.catalogEntry.deleteMany({ where: { testId } });
    await prisma.catalogTestProjection.deleteMany({ where: { testId } });
    await prisma.catalogBenchmarkProjection.deleteMany({
      where: { benchmarkId },
    });

    await expect(
      prisma.metricResult.findUniqueOrThrow({
        where: { id: created.body.id as string },
      })
    ).resolves.toMatchObject({ benchmarkId, testId, metricId, modelId });
  });

  it('prevents deleting a Metric assigned by a remote Test projection', async () => {
    const metricId = await seedPublishedProjection();

    await request(app.getHttpServer())
      .delete(`/api/metrics/${metricId}`)
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .expect(409);

    await prisma.catalogTestProjection.update({
      where: { testId },
      data: { metricIds: [] },
    });

    await request(app.getHttpServer())
      .delete(`/api/metrics/${metricId}`)
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .expect(204);
  });

  function createResult(metricId: string, value: number) {
    return request(app.getHttpServer())
      .post('/api/metrics/results')
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send({ testId, metricId, modelId, value });
  }

  async function seedPublishedProjection(): Promise<string> {
    const metricId = await seedMetric('projection-result-metric');
    await prisma.model.create({
      data: { id: modelId, name: 'Remote Result Model' },
    });
    await prisma.catalogBenchmarkProjection.create({
      data: {
        benchmarkId,
        aggregateVersion: 3,
        name: 'Remote Result Benchmark',
        nameEn: 'Remote Result Benchmark EN',
        sourceCreatedAt,
        sourceUpdatedAt,
      },
    });
    await prisma.catalogTestProjection.create({
      data: {
        testId,
        benchmarkId,
        aggregateVersion: 7,
        snapshot: { id: testId },
        name: 'Remote Result Test',
        nameEn: 'Remote Result Test EN',
        metricIds: [metricId],
        sourceCreatedAt,
        sourceUpdatedAt,
      },
    });
    await prisma.catalogEntry.create({
      data: { testId, status: BenchmarkValidationStatus.published },
    });
    return metricId;
  }

  async function seedMetric(name: string): Promise<string> {
    const priority = await prisma.metricPriorityLookup.findUniqueOrThrow({
      where: { code: 'primary' },
    });
    const direction = await prisma.metricDirectionLookup.findUniqueOrThrow({
      where: { code: 'higher_is_better' },
    });
    const metric = await prisma.metricDefinition.create({
      data: {
        name,
        priorityId: priority.id,
        directionId: direction.id,
      },
    });
    return metric.id;
  }

  function lockCommandCount(): Promise<number> {
    return prisma.outboxMessage.count({
      where: {
        topic: KAFKA_TOPICS.benchmarkCommands,
        aggregateId: testId,
        eventType: BENCHMARK_MESSAGE_TYPES.testSpecificationLockRequested,
      },
    });
  }

  async function clearFixtures(): Promise<void> {
    await prisma.metricUploadRow.deleteMany();
    await prisma.metricResult.deleteMany();
    await prisma.outboxMessage.deleteMany({
      where: { topic: KAFKA_TOPICS.benchmarkCommands },
    });
    await prisma.catalogEntry.deleteMany();
    await prisma.catalogTestProjection.deleteMany();
    await prisma.catalogBenchmarkProjection.deleteMany();
    await prisma.metricDefinition.deleteMany();
    await prisma.model.deleteMany();
  }
});
