import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@/common/enums/role.enum';
import { BenchmarkValidationStatus } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { createAuthCookie, E2E_ORIGIN } from './support/auth';
import { createE2eApplication } from './support/create-e2e-application';

describe('Metrics HTTP contract (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie: string;

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

  async function clearFixtures(): Promise<void> {
    await prisma.metricResult.deleteMany();
    await prisma.catalogEntry.deleteMany();
    await prisma.catalogTestProjection.deleteMany();
    await prisma.catalogBenchmarkProjection.deleteMany();
    await prisma.metricDefinition.deleteMany();
    await prisma.model.deleteMany();
  }

  async function getDefaultLookups() {
    const priority = await prisma.metricPriorityLookup.findUniqueOrThrow({
      where: { code: 'primary' },
    });
    const direction = await prisma.metricDirectionLookup.findUniqueOrThrow({
      where: { code: 'higher_is_better' },
    });
    return { priority, direction };
  }

  async function createMetric(
    name: string,
    overrides: Record<string, unknown> = {},
    expectedStatus = 201
  ) {
    const { priority, direction } = await getDefaultLookups();
    return request(app.getHttpServer())
      .post('/api/metrics')
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send({
        name,
        displayName: `${name} display`,
        priorityId: priority.id,
        directionId: direction.id,
        minValue: 0,
        maxValue: 1,
        ...overrides,
      })
      .expect(expectedStatus);
  }

  it('exposes stable default lookups and protects metric definitions with auth', async () => {
    await request(app.getHttpServer()).get('/api/metrics').expect(401);

    const priorities = await request(app.getHttpServer())
      .get('/api/metrics/lookups/priorities')
      .set('Cookie', adminCookie)
      .expect(200);
    const directions = await request(app.getHttpServer())
      .get('/api/metrics/lookups/directions')
      .set('Cookie', adminCookie)
      .expect(200);

    expect(priorities.body.map((item: { code: string }) => item.code)).toEqual([
      'primary',
      'secondary',
    ]);
    expect(directions.body.map((item: { code: string }) => item.code)).toEqual([
      'higher_is_better',
      'lower_is_better',
    ]);
  });

  it('validates lookup references and numeric ranges before creating a Metric', async () => {
    const { priority, direction } = await getDefaultLookups();

    await request(app.getHttpServer())
      .post('/api/metrics')
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send({
        name: 'missing-priority',
        priorityId: '00000000-0000-4000-8000-000000000001',
        directionId: direction.id,
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/metrics')
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send({
        name: 'invalid-range',
        priorityId: priority.id,
        directionId: direction.id,
        minValue: 10,
        maxValue: 1,
      })
      .expect(400);

    expect(await prisma.metricDefinition.count()).toBe(0);
  });

  it('keeps Test-owned evaluation fields out of the Metric contract', async () => {
    await createMetric(
      'metric-with-evaluation-logic',
      { evaluationLogic: 'must belong to Test' },
      400
    );

    const metric = await createMetric('contract-only-metric');
    await request(app.getHttpServer())
      .patch(`/api/metrics/${metric.body.id}`)
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send({ requiredGigaChatQualityLevel: 'must belong to Test' })
      .expect(400);

    const metricColumns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'metric_definitions'
    `;
    expect(metricColumns.map(({ column_name }) => column_name)).not.toEqual(
      expect.arrayContaining([
        'evaluation_logic',
        'required_gigachat_quality_level',
      ])
    );

    const response = await request(app.getHttpServer())
      .get(`/api/metrics/${metric.body.id}`)
      .set('Cookie', adminCookie)
      .expect(200);

    expect(response.body).not.toHaveProperty('evaluationLogic');
    expect(response.body).not.toHaveProperty('requiredGigaChatQualityLevel');
  });

  it('does not expose a partial Run model in result storage', async () => {
    const columns = await prisma.$queryRaw<
      Array<{ table_name: string; column_name: string }>
    >`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('metric_results', 'metric_upload_rows')
        AND column_name = 'run_id'
    `;

    expect(columns).toEqual([]);
  });

  it('keeps canonical MetricResult storage strictly Test-level', async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'metric_results'
        AND column_name = 'raw_subsample_name'
    `;

    expect(columns).toEqual([]);
  });

  it('creates, reads and partially updates Decimal Metric fields without losing values', async () => {
    const created = await createMetric('accuracy', {
      minValue: 0.1,
      maxValue: 0.9,
      targetValue: 0.8,
      metadata: { unit: 'ratio' },
    });

    expect(created.body).toMatchObject({
      name: 'accuracy',
      minValue: '0.1',
      maxValue: '0.9',
      targetValue: '0.8',
      metadata: { unit: 'ratio' },
    });

    const updated = await request(app.getHttpServer())
      .patch(`/api/metrics/${created.body.id}`)
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send({ displayName: 'Accuracy updated', maxValue: 1 })
      .expect(200);

    expect(updated.body).toMatchObject({
      displayName: 'Accuracy updated',
      minValue: '0.1',
      maxValue: '1',
      targetValue: '0.8',
      metadata: { unit: 'ratio' },
    });
    const detail = await request(app.getHttpServer())
      .get(`/api/metrics/${created.body.id}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(detail.body).toEqual(updated.body);
  });

  it('rejects duplicate Metric names and keeps the original row unchanged', async () => {
    const original = await createMetric('exact-match');
    await createMetric('second-metric');

    await createMetric('exact-match', {}, 409);
    await request(app.getHttpServer())
      .patch(`/api/metrics/${original.body.id}`)
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send({ name: 'second-metric' })
      .expect(409);

    expect(
      await prisma.metricDefinition.findUniqueOrThrow({
        where: { id: original.body.id as string },
        select: { name: true },
      })
    ).toEqual({ name: 'exact-match' });
  });

  it('rejects null required Metric fields without mutation and still clears nullable values', async () => {
    const created = await createMetric('null-boundary-metric', {
      targetValue: 0.8, metadata: { unit: 'ratio' },
    });
    const id = created.body.id as string;
    const before = await prisma.metricDefinition.findUniqueOrThrow({ where: { id } });
    for (const field of ['name', 'priorityId', 'directionId', 'metadata']) {
      await request(app.getHttpServer())
        .patch(`/api/metrics/${id}`)
        .set('Origin', E2E_ORIGIN)
        .set('Cookie', adminCookie)
        .send({ [field]: null })
        .expect(400);
    }
    expect(await prisma.metricDefinition.findUniqueOrThrow({ where: { id } })).toEqual(before);
    const cleared = await request(app.getHttpServer())
      .patch(`/api/metrics/${id}`)
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send({ displayName: null, minValue: null, maxValue: null, targetValue: null })
      .expect(200);
    expect(cleared.body).toMatchObject({
      name: before.name, priorityId: before.priorityId, directionId: before.directionId,
      displayName: null, minValue: null, maxValue: null, targetValue: null, metadata: before.metadata,
    });
  });

  it('accepts empty metadata on create and clears it explicitly without changing omitted fields', async () => {
    const created = await createMetric('empty-metadata', { metadata: {} });
    expect(created.body.metadata).toEqual({});
    const id = created.body.id as string;
    const patch = (body: object) => request(app.getHttpServer())
      .patch(`/api/metrics/${id}`)
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send(body);
    await patch({ metadata: { unit: 'ratio', nested: { version: 1 } } }).expect(200);
    await patch({ displayName: 'Metadata omitted' }).expect(200);
    expect((await prisma.metricDefinition.findUniqueOrThrow({ where: { id } })).metadata)
      .toEqual({ unit: 'ratio', nested: { version: 1 } });
    const before = await prisma.metricDefinition.findUniqueOrThrow({ where: { id } });
    for (const metadata of [null, [], 'invalid', 0, false]) {
      await createMetric('invalid-metadata', { metadata }, 400);
      await patch({ metadata }).expect(400);
    }
    expect(await prisma.metricDefinition.count()).toBe(1);
    expect(await prisma.metricDefinition.findUniqueOrThrow({ where: { id } })).toEqual(before);
    const cleared = await patch({ metadata: {} }).expect(200);
    expect(cleared.body).toEqual({ ...created.body, displayName: 'Metadata omitted',
      metadata: {}, updatedAt: expect.any(String) });
    expect((await prisma.metricDefinition.findUniqueOrThrow({ where: { id } })).metadata).toEqual({});
  });

  it('searches, sorts and paginates Metric definitions', async () => {
    await createMetric('zeta-score', { displayName: 'Common Zeta' });
    await createMetric('alpha-score', { displayName: 'Common Alpha' });
    await createMetric('unrelated', { displayName: 'Other' });

    const firstPage = await request(app.getHttpServer())
      .get('/api/metrics')
      .set('Cookie', adminCookie)
      .query({
        search: 'common',
        page: 1,
        limit: 1,
        sortColumn: 'name',
        sortDirection: 'ASC',
      })
      .expect(200);
    const secondPage = await request(app.getHttpServer())
      .get('/api/metrics')
      .set('Cookie', adminCookie)
      .query({
        search: 'common',
        page: 2,
        limit: 1,
        sortColumn: 'name',
        sortDirection: 'ASC',
      })
      .expect(200);

    expect(firstPage.body).toMatchObject({
      total: 2,
      data: [{ name: 'alpha-score' }],
    });
    expect(secondPage.body).toMatchObject({
      total: 2,
      data: [{ name: 'zeta-score' }],
    });
  });

  it('upserts Model identity and exposes the updated public model list', async () => {
    await request(app.getHttpServer())
      .post('/api/metrics/models')
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send({
        id: 'model-stable-id',
        name: 'Original Model',
        provider: 'Original Provider',
        isOpenSource: false,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/metrics/models')
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send({
        id: 'model-stable-id',
        name: 'Renamed Model',
        provider: 'New Provider',
        isOpenSource: true,
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get('/api/metrics/models')
      .expect(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: 'model-stable-id',
        name: 'Renamed Model',
        provider: 'New Provider',
        isOpenSource: true,
      }),
    ]);
    expect(await prisma.model.count()).toBe(1);
  });

  it('validates MetricResult references and returns paginated results for one Test only', async () => {
    const metric = await createMetric('result-score');
    const suiteId = randomUUID();
    const firstTest = { id: randomUUID() };
    const secondTest = { id: randomUUID() };
    const sourceDate = new Date('2026-09-14T00:00:00.000Z');
    await prisma.catalogBenchmarkProjection.create({
      data: {
        benchmarkId: suiteId,
        aggregateVersion: 1,
        name: 'Result Suite',
        nameEn: 'Result Suite EN',
        sourceCreatedAt: sourceDate,
        sourceUpdatedAt: sourceDate,
      },
    });
    await prisma.catalogTestProjection.createMany({
      data: [
        {
          testId: firstTest.id,
          benchmarkId: suiteId,
          aggregateVersion: 1,
          snapshot: { id: firstTest.id },
          name: 'First Result Test',
          nameEn: 'First Result Test EN',
          metricIds: [metric.body.id as string],
          sourceCreatedAt: sourceDate,
          sourceUpdatedAt: sourceDate,
        },
        {
          testId: secondTest.id,
          benchmarkId: suiteId,
          aggregateVersion: 1,
          snapshot: { id: secondTest.id },
          name: 'Second Result Test',
          nameEn: 'Second Result Test EN',
          sourceCreatedAt: sourceDate,
          sourceUpdatedAt: sourceDate,
        },
      ],
    });
    await prisma.catalogEntry.create({
      data: {
        testId: firstTest.id,
        status: BenchmarkValidationStatus.published,
      },
    });
    await prisma.model.create({
      data: { id: 'result-model', name: 'Result Model' },
    });

    await request(app.getHttpServer())
      .post('/api/metrics/results')
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send({
        testId: firstTest.id,
        metricId: metric.body.id,
        modelId: 'result-model',
        value: 0.1,
        runId: '00000000-0000-4000-8000-000000000001',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/metrics/results')
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send({
        testId: firstTest.id,
        metricId: metric.body.id,
        modelId: 'missing-model',
        value: 0.1,
      })
      .expect(404);

    for (const [value, obtainedAt] of [
      [0.25, '2026-01-01T00:00:00.000Z'],
      [0.75, '2026-02-01T00:00:00.000Z'],
    ] as const) {
      await request(app.getHttpServer())
        .post('/api/metrics/results')
        .set('Origin', E2E_ORIGIN)
        .set('Cookie', adminCookie)
        .send({
          testId: firstTest.id,
          metricId: metric.body.id,
          modelId: 'result-model',
          value,
          obtainedAt,
        })
        .expect(201);
    }
    await request(app.getHttpServer())
      .post('/api/metrics/results')
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send({
        testId: secondTest.id,
        metricId: metric.body.id,
        modelId: 'result-model',
        value: 0.5,
      })
      .expect(400);

    await expect(
      prisma.catalogTestProjection.findUniqueOrThrow({
        where: { testId: secondTest.id },
        select: { metricIds: true },
      })
    ).resolves.toEqual({ metricIds: [] });
    expect(
      await prisma.metricResult.count({
        where: { testId: secondTest.id },
      })
    ).toBe(0);

    const response = await request(app.getHttpServer())
      .get(`/api/metrics/tests/${firstTest.id}/results`)
      .query({ page: 1, limit: 1, sortColumn: 'obtainedAt', sortDirection: 'DESC' })
      .expect(200);

    expect(response.body.total).toBe(2);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      testId: firstTest.id,
      modelId: 'result-model',
      metricId: metric.body.id,
      value: '0.75',
      obtainedAt: '2026-02-01T00:00:00.000Z',
    });
    expect(response.body.data[0].metric).not.toHaveProperty('evaluationLogic');
    expect(response.body.data[0].metric).not.toHaveProperty(
      'requiredGigaChatQualityLevel'
    );
    expect(response.body.data[0]).not.toHaveProperty('rawSubsampleName');
  });
});
