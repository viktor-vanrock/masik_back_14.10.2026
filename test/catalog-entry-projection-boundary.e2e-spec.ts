import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  BENCHMARK_MESSAGE_TYPES,
  BenchmarkTestSnapshotV1,
} from '@/benchmark-service/contracts/benchmark-integration.v1';
import { CatalogBenchmarkProjectionService } from '@/catalog/projection/catalog-benchmark-projection.service';
import { Role } from '@/common/enums/role.enum';
import { BenchmarkValidationStatus } from '@/generated/prisma/client';
import { KAFKA_TOPICS } from '@/kafka/kafka.constants';
import { PrismaService } from '@/prisma/prisma.service';
import { createAuthCookie, E2E_ORIGIN } from './support/auth';
import { createE2eApplication } from './support/create-e2e-application';

describe('CatalogEntry projection boundary (e2e)', () => {
  const suiteId = 'a1000000-0000-4000-8000-000000000001';
  const testId = 'a2000000-0000-4000-8000-000000000002';
  const authorId = '00000000-0000-4000-8000-000000000001';
  let app: INestApplication;
  let prisma: PrismaService;
  let projection: CatalogBenchmarkProjectionService;
  let userCookie: string;
  let adminCookie: string;
  let metricId: string;
  let offset = 0;

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
    projection = app.get(CatalogBenchmarkProjectionService);
    userCookie = await createAuthCookie(app, Role.User);
    adminCookie = await createAuthCookie(app, Role.Admin);
  });

  beforeEach(async () => {
    offset = 0;
    await clearFixtures();
    metricId = await createMetric();
    await applySuite();
    await applyTest(snapshot(metricId));
    await prisma.catalogEntry.create({
      data: {
        testId,
        authorId,
        status: BenchmarkValidationStatus.validation,
      },
    });
  });

  afterAll(async () => {
    await clearFixtures();
    await app.close();
  });

  it('lists, reads and moderates a remote Test from projections', async () => {
    const mine = await request(app.getHttpServer())
      .get('/api/catalog/submissions/mine?page=1&limit=10&search=projected')
      .set('Cookie', userCookie)
      .expect(200);
    expect(mine.body).toMatchObject({
      total: 1,
      data: [
        {
          id: testId,
          name: 'Projected submission',
          validationStatus: BenchmarkValidationStatus.validation,
          catalogEntry: {
            authorId,
            status: BenchmarkValidationStatus.validation,
          },
        },
      ],
    });

    await request(app.getHttpServer())
      .get(`/api/catalog/submissions/${testId}`)
      .set('Cookie', userCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: testId, metrics: ['projection-metric'] });
      });

    const published = await request(app.getHttpServer())
      .patch(`/api/catalog/entries/${testId}/moderation`)
      .set('Cookie', adminCookie)
      .set('Origin', E2E_ORIGIN)
      .send({ status: BenchmarkValidationStatus.published })
      .expect(200);
    expect(published.body).toMatchObject({
      id: testId,
      validationStatus: BenchmarkValidationStatus.published,
      catalogEntry: { status: BenchmarkValidationStatus.published },
    });

    await request(app.getHttpServer())
      .get(`/api/benchmark-tests/${testId}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: testId, name: 'Projected submission' });
      });
  });

  it('does not publish while removal of assigned metrics is pending', async () => {
    const updated = await request(app.getHttpServer())
      .patch(`/api/benchmark-tests/${testId}`)
      .set('Cookie', adminCookie)
      .set('Origin', E2E_ORIGIN)
      .send({ metrics: [] })
      .expect(202);
    await request(app.getHttpServer())
      .patch(`/api/catalog/entries/${testId}/moderation`)
      .set('Cookie', adminCookie)
      .set('Origin', E2E_ORIGIN)
      .send({ status: BenchmarkValidationStatus.published })
      .expect(409);
    await expect(prisma.catalogEntry.findUnique({ where: { testId } })).resolves.toMatchObject({
      status: BenchmarkValidationStatus.validation,
    });

    const initial = snapshot(metricId);
    const next = {
      ...initial,
      aggregateVersion: 2,
      specification: { ...initial.specification, metricIds: [] },
    };
    await applyTest(next, updated.body.operationId);
    await request(app.getHttpServer())
      .patch(`/api/catalog/entries/${testId}/moderation`)
      .set('Cookie', adminCookie)
      .set('Origin', E2E_ORIGIN)
      .send({ status: BenchmarkValidationStatus.published })
      .expect(400)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'TEST_METRIC_REQUIRED' });
      });
  });

  it('resets an owned deleted submission only after a successful restore', async () => {
    await rejectSubmission();
    const originalEntry = await prisma.catalogEntry.findUniqueOrThrow({ where: { testId } });
    await applyTest({ ...snapshot(metricId), aggregateVersion: 2, deletedAt: new Date().toISOString() });

    const failed = await restoreSubmission();
    await expect(prisma.catalogEntry.findUnique({ where: { testId } })).resolves.toEqual(originalEntry);
    await projection.apply(
      {
        eventId: randomUUID(),
        eventType: BENCHMARK_MESSAGE_TYPES.commandRejected,
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        correlationId: randomUUID(),
        causationId: failed.body.operationId,
        producer: 'benchmark-service',
        aggregateType: 'test',
        aggregateId: testId,
        aggregateVersion: 2,
        data: {
          commandEventId: failed.body.operationId,
          reasonCode: 'AGGREGATE_VERSION_CONFLICT',
          statusCode: 409,
          message: 'Concurrent source change',
        },
      },
      metadata()
    );
    await expect(prisma.catalogEntry.findUnique({ where: { testId } })).resolves.toEqual(originalEntry);
    await request(app.getHttpServer())
      .get(`/api/benchmark-operations/${failed.body.operationId}`)
      .set('Cookie', userCookie)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('rejected'));

    const restored = await restoreSubmission();
    expect(restored.body.operationId).not.toBe(failed.body.operationId);
    await applyTest({ ...snapshot(metricId), aggregateVersion: 3 }, restored.body.operationId);
    await expect(prisma.catalogEntry.findUnique({ where: { testId } })).resolves.toMatchObject({
      authorId,
      status: BenchmarkValidationStatus.validation,
      rejectionReason: null,
      reviewedById: null,
      reviewedAt: null,
      archivedAt: null,
    });
    await request(app.getHttpServer())
      .get(`/api/catalog/submissions/${testId}`)
      .set('Cookie', userCookie)
      .expect(200);

    // An already active Test is an idempotent restore, not a resubmission.
    await rejectSubmission();
    const activeEntry = await prisma.catalogEntry.findUniqueOrThrow({ where: { testId } });
    const activeRestore = await restoreSubmission();
    await applyTest({ ...snapshot(metricId), aggregateVersion: 3 }, activeRestore.body.operationId);
    await expect(prisma.catalogEntry.findUnique({ where: { testId } })).resolves.toEqual(activeEntry);
  });

  it('preserves moderation when an administrator restores a deleted Test', async () => {
    await rejectSubmission();
    const originalEntry = await prisma.catalogEntry.findUniqueOrThrow({ where: { testId } });
    await applyTest({ ...snapshot(metricId), aggregateVersion: 2, deletedAt: new Date().toISOString() });
    const restored = await request(app.getHttpServer())
      .post(`/api/benchmark-tests/${testId}/restore`)
      .set('Cookie', adminCookie)
      .set('Origin', E2E_ORIGIN)
      .expect(202);
    await applyTest({ ...snapshot(metricId), aggregateVersion: 3 }, restored.body.operationId);
    await expect(prisma.catalogEntry.findUnique({ where: { testId } })).resolves.toEqual(originalEntry);
  });

  function rejectSubmission() {
    return request(app.getHttpServer())
      .patch(`/api/catalog/entries/${testId}/moderation`)
      .set('Cookie', adminCookie)
      .set('Origin', E2E_ORIGIN)
      .send({ status: BenchmarkValidationStatus.rejected, rejectionReason: 'Needs revision' })
      .expect(200);
  }

  function restoreSubmission() {
    return request(app.getHttpServer())
      .post(`/api/catalog/submissions/${testId}/restore`)
      .set('Cookie', userCookie)
      .set('Origin', E2E_ORIGIN)
      .expect(202);
  }

  async function createMetric(): Promise<string> {
    const suffix = randomUUID();
    const priority = await prisma.metricPriorityLookup.create({
      data: { code: `projection-priority-${suffix}`, name: 'Projection priority' },
    });
    const direction = await prisma.metricDirectionLookup.create({
      data: { code: `projection-direction-${suffix}`, name: 'Projection direction' },
    });
    const metric = await prisma.metricDefinition.create({
      data: {
        name: 'projection-metric',
        priorityId: priority.id,
        directionId: direction.id,
      },
    });
    return metric.id;
  }

  async function applySuite(): Promise<void> {
    await projection.apply(
      {
        eventId: randomUUID(),
        eventType: BENCHMARK_MESSAGE_TYPES.suiteSnapshot,
        eventVersion: 1,
        occurredAt: '2026-09-13T00:00:00.000Z',
        correlationId: randomUUID(),
        causationId: null,
        producer: 'benchmark-service',
        aggregateType: 'benchmark',
        aggregateId: suiteId,
        aggregateVersion: 1,
        data: {
          benchmark: {
            id: suiteId,
            aggregateVersion: 1,
            name: 'Projected suite',
            nameEn: 'Projected suite EN',
            description: 'Remote suite',
            createdAt: '2026-09-13T00:00:00.000Z',
            updatedAt: '2026-09-13T00:00:00.000Z',
            deletedAt: null,
          },
        },
      },
      metadata()
    );
  }

  async function applyTest(value: BenchmarkTestSnapshotV1, causationId: string | null = null): Promise<void> {
    await projection.apply(
      {
        eventId: randomUUID(),
        eventType: BENCHMARK_MESSAGE_TYPES.testSnapshot,
        eventVersion: 1,
        occurredAt: '2026-09-13T00:00:00.000Z',
        correlationId: randomUUID(),
        causationId,
        producer: 'benchmark-service',
        aggregateType: 'test',
        aggregateId: testId,
        aggregateVersion: value.aggregateVersion,
        data: { test: value },
      },
      metadata()
    );
  }

  function metadata() {
    return {
      topic: KAFKA_TOPICS.benchmarkEvents,
      partition: 0,
      offset: String(offset++),
    };
  }

  async function clearFixtures(): Promise<void> {
    await prisma.benchmarkCommandActor.deleteMany({ where: { actorId: authorId } });
    await prisma.benchmarkCommandOutcome.deleteMany({ where: { aggregateId: testId } });
    await prisma.outboxMessage.deleteMany({ where: { aggregateId: testId } });
    await prisma.benchmarkSearchDocument.deleteMany({
      where: { benchmarkTestId: testId },
    });
    await prisma.catalogEntry.deleteMany({ where: { testId } });
    await prisma.metricResult.deleteMany({ where: { testId } });
    await prisma.catalogTestProjection.deleteMany({ where: { testId } });
    await prisma.catalogBenchmarkProjection.deleteMany({
      where: { benchmarkId: suiteId },
    });
    await prisma.inboxMessage.deleteMany({
      where: {
        OR: [
          { aggregateId: testId },
          { aggregateId: suiteId },
        ],
      },
    });
    await prisma.metricDefinition.deleteMany({
      where: { name: 'projection-metric' },
    });
    await prisma.metricPriorityLookup.deleteMany({
      where: { code: { startsWith: 'projection-priority-' } },
    });
    await prisma.metricDirectionLookup.deleteMany({
      where: { code: { startsWith: 'projection-direction-' } },
    });
  }
});

function snapshot(metricId: string): BenchmarkTestSnapshotV1 {
  return {
    id: 'a2000000-0000-4000-8000-000000000002',
    aggregateVersion: 1,
    specification: {
      suiteId: 'a1000000-0000-4000-8000-000000000001',
      name: 'Projected submission',
      nameEn: 'Projected submission EN',
      description: 'Remote Test content',
      subGroupIds: [],
      abilityTaxonIds: [],
      modalityIds: [],
      capabilityIds: [],
      domainIds: [],
      subdomainIds: [],
      abilityTags: [],
      skills: [],
      metricIds: [metricId],
      examples: [],
      datasetSubsamples: [],
      references: [],
      links: [],
      sizeInSamples: 10,
      medianSampleSizeWords: 2,
      requestLengthDist: { min: 1, median: 2, max: 3 },
      responseLengthDist: { min: 1, median: 2, max: 3 },
      isDifficultyAutoCalculated: false,
      isGenerated: false,
    },
    specificationLockedAt: null,
    specificationLockReason: null,
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
    deletedAt: null,
  };
}
