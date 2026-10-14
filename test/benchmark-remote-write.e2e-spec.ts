import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  BENCHMARK_MESSAGE_TYPES,
  BenchmarkSuiteSnapshotV1,
  BenchmarkTestSnapshotV1,
  parseBenchmarkIntegrationMessageV1,
} from '@/benchmark-service/contracts/benchmark-integration.v1';
import { CatalogBenchmarkProjectionService } from '@/catalog/projection/catalog-benchmark-projection.service';
import { Role } from '@/common/enums/role.enum';
import { BenchmarkValidationStatus } from '@/generated/prisma/client';
import { KAFKA_TOPICS } from '@/kafka/kafka.constants';
import { PrismaService } from '@/prisma/prisma.service';
import { createAuthCookie, E2E_ORIGIN } from './support/auth';
import { createE2eApplication } from './support/create-e2e-application';

describe('Benchmark asynchronous writes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let projection: CatalogBenchmarkProjectionService;
  let adminCookie: string;
  let superUserCookie: string;
  let userCookie: string;
  let offset = 0;
  const aggregateIds = new Set<string>();

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
    projection = app.get(CatalogBenchmarkProjectionService);
    adminCookie = await createAuthCookie(app, Role.Admin);
    superUserCookie = await createAuthCookie(app, Role.SuperUser);
    userCookie = await createAuthCookie(app, Role.User);
  });

  beforeEach(async () => {
    await clearFixtures();
    offset = 0;
  });

  afterAll(async () => {
    await clearFixtures();
    await app.close();
  });

  it('queues the complete Suite lifecycle', async () => {
    const created = await mutate('post', '/api/benchmarks', adminCookie, {
      name: 'Remote write suite',
      nameEn: 'Remote write suite EN',
      description: 'Created through Kafka',
    }).expect(202);
    const suiteId = created.body.aggregateId as string;
    aggregateIds.add(suiteId);
    expect(created.body).toMatchObject({
      operationId: expect.any(String),
      aggregateId: suiteId,
      aggregateType: 'benchmark',
      status: 'queued',
      statusUrl: `/api/benchmark-operations/${created.body.operationId}`,
    });
    await expectCommand(created.body.operationId, {
      eventType: BENCHMARK_MESSAGE_TYPES.suiteCreateRequested,
      aggregateVersion: 1,
      data: {
        benchmarkId: suiteId,
        specification: {
          name: 'Remote write suite',
          description: 'Created through Kafka',
        },
      },
    });

    await applySnapshot(
      suiteSnapshot(suiteId, 1, {
        name: 'Remote write suite',
        description: 'Created through Kafka',
      }),
      created.body.operationId
    );
    await expectApplied(created.body.operationId);

    const updated = await mutate(
      'patch',
      `/api/benchmarks/${suiteId}`,
      adminCookie,
      { name: 'Remote write suite updated' }
    ).expect(202);
    await expectCommand(updated.body.operationId, {
      eventType: BENCHMARK_MESSAGE_TYPES.suiteUpdateRequested,
      aggregateVersion: 1,
      data: {
        benchmarkId: suiteId,
        expectedAggregateVersion: 1,
        specification: {
          name: 'Remote write suite updated',
          nameEn: 'Remote write suite EN',
          description: 'Created through Kafka',
        },
      },
    });
    await applySnapshot(
      suiteSnapshot(suiteId, 2, {
        name: 'Remote write suite updated',
        description: 'Created through Kafka',
      }),
      updated.body.operationId
    );

    const deleted = await mutate(
      'delete',
      `/api/benchmarks/${suiteId}`,
      superUserCookie
    ).expect(202);
    await expectCommand(deleted.body.operationId, {
      eventType: BENCHMARK_MESSAGE_TYPES.suiteDeleteRequested,
      aggregateVersion: 2,
      data: { benchmarkId: suiteId, expectedAggregateVersion: 2 },
    });
    await applyDeleted(suiteId, 3, deleted.body.operationId);

    const restored = await mutate(
      'post',
      `/api/benchmarks/${suiteId}/restore`,
      adminCookie
    ).expect(202);
    await expectCommand(restored.body.operationId, {
      eventType: BENCHMARK_MESSAGE_TYPES.suiteRestoreRequested,
      aggregateVersion: 3,
      data: { benchmarkId: suiteId, expectedAggregateVersion: 3 },
    });
    await applySnapshot(
      suiteSnapshot(suiteId, 4, {
        name: 'Remote write suite updated',
        description: 'Created through Kafka',
      }),
      restored.body.operationId
    );

    await request(app.getHttpServer())
      .get(`/api/benchmarks/${suiteId}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: suiteId,
          name: 'Remote write suite updated',
        });
      });
  });

  it('rejects null Test fields before queuing and preserves omitted fields while accepting explicit clearing', async () => {
    const suiteId = randomUUID();
    aggregateIds.add(suiteId);
    await applySnapshot(suiteSnapshot(suiteId, 1));
    const body = {
      suiteId, name: 'Null boundary Test', nameEn: 'Null boundary Test EN',
      description: 'Must survive rejected patches',
      codebase: { name: 'implementation', url: 'https://example.test/code' },
      metrics: ['remote-write-metric'],
      examples: [{ input: 'question', output: 'answer' }],
      datasetSubsamples: [{ name: 'validation', nameEn: 'validation',
        examples: [{ input: 'nested question', output: 'nested answer' }] }],
    };
    const beforeCreate = await prisma.outboxMessage.count();
    await mutate('post', '/api/benchmark-tests', adminCookie, { ...body, examples: null }).expect(400);
    expect(await prisma.outboxMessage.count()).toBe(beforeCreate);
    const created = await mutate('post', '/api/benchmark-tests', adminCookie, body).expect(202);
    const testId = created.body.aggregateId as string;
    aggregateIds.add(testId);
    const initial = await command(created.body.operationId);
    if (BENCHMARK_MESSAGE_TYPES.testCreateRequested !== initial.eventType) throw new Error('Expected create');
    const specification = initial.data.specification;
    await applyTestSnapshot(testSnapshot(testId, 1, specification), created.body.operationId);
    const before = await prisma.catalogTestProjection.findUniqueOrThrow({ where: { testId } });
    const entries = await prisma.catalogEntry.findMany({ where: { testId } });
    const commands = await commandCount(testId);
    const nonNullableFields = [
      'suiteId', 'name', 'nameEn', 'description', 'descriptionEn', 'shortDescription',
      'taskDescription', 'instructions', 'instructionsEn', 'skills', 'abilityTags',
      'subGroupIds', 'abilityTaxonIds', 'domainIds', 'subdomainIds', 'modalityIds',
      'capabilityIds', 'metrics', 'examples', 'references', 'links', 'datasetSubsamples',
      'sizeInSamples', 'medianSampleSizeWords', 'requestLengthDist', 'responseLengthDist',
      'isGenerated', 'isDifficultyAutoCalculated', 'confidenceScore', 'humanBaseline',
      'confidentialityLevel', 'knowledgeLevel', 'importance', 'importanceComment',
      'contextFieldFormat', 'answerFieldFormat', 'evaluationLogic', 'humanBaselineNotes',
      'recommendedMetricsDescription', 'requiredGigaChatQualityLevel',
      'difficultyCalculationComment', 'gigaMetricsCodebaseUrl', 'gigaMetricAdapterName',
      'gigaMetricSetUrl', 'gigaMetricLaunchCommand', 'jiraTicketId',
    ];
    for (const field of nonNullableFields) {
      await mutate('post', '/api/benchmark-tests', adminCookie, { ...body, [field]: null }).expect(400);
      await mutate('patch', `/api/benchmark-tests/${testId}`, adminCookie, { [field]: null }).expect(400);
    }
    const subsample = specification.datasetSubsamples[0];
    const nestedNullCases: Record<string, unknown>[] = [];
    for (const field of [
      'skills', 'abilityTags', 'subGroupIds', 'abilityTaxonIds', 'domainIds',
      'subdomainIds', 'modalityIds', 'capabilityIds', 'metrics', 'examples',
      'references', 'links', 'datasetSubsamples',
    ]) nestedNullCases.push({ [field]: [null] });
    for (const field of [
      'id', 'name', 'nameEn', 'description', 'sizeInSamples', 'medianSampleSizeWords',
      'requestLengthDist', 'responseLengthDist', 'split', 'examples',
    ]) nestedNullCases.push({ datasetSubsamples: [{ ...subsample, [field]: null }] });
    nestedNullCases.push({ datasetSubsamples: [{ ...subsample, examples: [null] }] });
    for (const field of ['input', 'output', 'explanation']) {
      const example = { input: 'question', output: 'answer', [field]: null };
      nestedNullCases.push({ examples: [example] });
      nestedNullCases.push({ datasetSubsamples: [{ ...subsample, examples: [example] }] });
    }
    for (const field of ['name', 'url']) {
      nestedNullCases.push({ codebase: { ...body.codebase, [field]: null } });
    }
    for (const field of ['title', 'url']) {
      const reference = { title: 'Reference', url: 'https://example.test/reference', [field]: null };
      nestedNullCases.push({ references: [reference] });
      nestedNullCases.push({ links: [{ type: 'docs', ...reference }] });
    }
    nestedNullCases.push({ links: [{ type: null, title: 'Reference', url: 'https://example.test/reference' }] });
    for (const distribution of ['requestLengthDist', 'responseLengthDist']) {
      for (const field of ['min', 'median', 'max']) {
        const value = { min: 0, median: 1, max: 2, [field]: null };
        nestedNullCases.push({ [distribution]: value });
        nestedNullCases.push({ datasetSubsamples: [{ ...subsample, [distribution]: value }] });
      }
    }
    for (const invalid of nestedNullCases) {
      await mutate('post', '/api/benchmark-tests', adminCookie, { ...body, ...invalid }).expect(400);
      await mutate('patch', `/api/benchmark-tests/${testId}`, adminCookie, invalid).expect(400);
    }
    expect(await commandCount(testId)).toBe(commands);
    expect(await prisma.outboxMessage.count()).toBe(beforeCreate + 1);
    expect(await prisma.catalogTestProjection.findUniqueOrThrow({ where: { testId } })).toEqual(before);
    expect(await prisma.catalogEntry.findMany({ where: { testId } })).toEqual(entries);

    const updated = await mutate('patch', `/api/benchmark-tests/${testId}`, adminCookie, {
      codebase: null, macroGroupId: null, taskTypeId: null, languageId: null, difficultyId: null,
    }).expect(202);
    const update = await command(updated.body.operationId);
    if (BENCHMARK_MESSAGE_TYPES.testUpdateRequested !== update.eventType) throw new Error('Expected update');
    expect(update.data.specification).toEqual({ ...specification, codebase: null });
    await applyTestSnapshot(testSnapshot(testId, 2, update.data.specification), updated.body.operationId);

    const cleared = await mutate('patch', `/api/benchmark-tests/${testId}`, adminCookie, {
      examples: [], datasetSubsamples: [], skills: [], abilityTags: [],
      subGroupIds: [], abilityTaxonIds: [], domainIds: [], subdomainIds: [],
      modalityIds: [], capabilityIds: [], references: [], links: [],
      isGenerated: false, isDifficultyAutoCalculated: false, sizeInSamples: 0,
      confidenceScore: 0, humanBaseline: 0, descriptionEn: '',
    }).expect(202);
    await expectCommand(cleared.body.operationId, { data: { specification: {
      name: body.name, description: body.description, codebase: null,
      metricIds: specification.metricIds, examples: [], datasetSubsamples: [],
      skills: [], abilityTags: [], references: [], links: [],
      isGenerated: false, isDifficultyAutoCalculated: false, sizeInSamples: 0,
      confidenceScore: 0, humanBaseline: 0, descriptionEn: '',
    } } });
  });

  it('rejects null Suite names while keeping nullable descriptions and omitted fields', async () => {
    const suiteId = randomUUID();
    aggregateIds.add(suiteId);
    await applySnapshot(suiteSnapshot(suiteId, 1, { description: 'Original', descriptionEn: 'Original EN' }));
    const before = await prisma.catalogBenchmarkProjection.findUniqueOrThrow({ where: { benchmarkId: suiteId } });
    const commands = await commandCount(suiteId);
    for (const field of ['name', 'nameEn']) {
      await mutate('patch', `/api/benchmarks/${suiteId}`, adminCookie, { [field]: null }).expect(400);
    }
    expect(await commandCount(suiteId)).toBe(commands);
    expect(await prisma.catalogBenchmarkProjection.findUniqueOrThrow({ where: { benchmarkId: suiteId } })).toEqual(before);
    const cleared = await mutate('patch', `/api/benchmarks/${suiteId}`, adminCookie, { description: null }).expect(202);
    await expectCommand(cleared.body.operationId, { data: { specification: {
      name: before.name, nameEn: before.nameEn, description: null, descriptionEn: 'Original EN',
    } } });
  });

  it('queues Test writes atomically with Catalog state and preserves invariants', async () => {
    const suiteId = randomUUID();
    const clientSubsampleId = randomUUID();
    aggregateIds.add(suiteId);
    await prisma.catalogBenchmarkProjection.create({
      data: {
        benchmarkId: suiteId,
        aggregateVersion: 1,
        name: 'Remote Test suite',
        nameEn: 'Remote Test suite EN',
        sourceCreatedAt: new Date('2026-09-13T00:00:00.000Z'),
        sourceUpdatedAt: new Date('2026-09-13T00:00:00.000Z'),
      },
    });

    const created = await mutate('post', '/api/benchmark-tests', adminCookie, {
      suiteId,
      name: 'Remote Test',
      nameEn: 'Remote Test EN',
      description: 'Owned by benchmark-service',
      evaluationLogic: 'exact match',
      metrics: ['remote-write-metric'],
      datasetSubsamples: [
        {
          id: clientSubsampleId,
          name: 'validation',
          nameEn: 'validation',
          examples: [{ input: 'question', output: 'answer' }],
        },
      ],
    }).expect(202);
    const testId = created.body.aggregateId as string;
    aggregateIds.add(testId);
    const createCommand = await command(created.body.operationId);
    expect(createCommand).toMatchObject({
      eventType: BENCHMARK_MESSAGE_TYPES.testCreateRequested,
      aggregateType: 'test',
      aggregateVersion: 1,
      data: {
        testId,
        specification: {
          suiteId,
          evaluationLogic: 'exact match',
          metricIds: [expect.any(String)],
          datasetSubsamples: [
            {
              id: expect.any(String),
              name: 'validation',
              examples: [{ input: 'question', output: 'answer' }],
            },
          ],
        },
      },
    });
    if (
      createCommand.eventType !== BENCHMARK_MESSAGE_TYPES.testCreateRequested
    ) {
      throw new Error('Expected Test create command');
    }
    const createdSpecification = createCommand.data.specification;
    expect(createdSpecification.datasetSubsamples[0].id).not.toBe(
      clientSubsampleId
    );
    await expect(
      prisma.catalogEntry.findUnique({ where: { testId } })
    ).resolves.toMatchObject({ status: BenchmarkValidationStatus.validation });
    await applyTestSnapshot(
      testSnapshot(testId, 1, createdSpecification),
      created.body.operationId
    );

    const unknownSubsampleCommands = await commandCount(testId);
    await mutate('patch', `/api/benchmark-tests/${testId}`, adminCookie, {
      datasetSubsamples: [
        { id: randomUUID(), name: 'foreign', nameEn: 'foreign' },
      ],
    }).expect(400);
    await expect(commandCount(testId)).resolves.toBe(unknownSubsampleCommands);

    const updated = await mutate(
      'patch',
      `/api/benchmark-tests/${testId}`,
      adminCookie,
      { evaluationLogic: 'normalized exact match' }
    ).expect(202);
    const updateCommand = await command(updated.body.operationId);
    expect(updateCommand).toMatchObject({
      eventType: BENCHMARK_MESSAGE_TYPES.testUpdateRequested,
      aggregateVersion: 1,
      data: {
        expectedAggregateVersion: 1,
        specification: {
          evaluationLogic: 'normalized exact match',
          metricIds: createdSpecification.metricIds,
          datasetSubsamples: createdSpecification.datasetSubsamples,
        },
      },
    });
    if (
      updateCommand.eventType !== BENCHMARK_MESSAGE_TYPES.testUpdateRequested
    ) {
      throw new Error('Expected Test update command');
    }
    const retried = await mutate(
      'patch',
      `/api/benchmark-tests/${testId}`,
      adminCookie,
      { evaluationLogic: 'normalized exact match' }
    ).expect(202);
    expect(retried.body.operationId).toBe(updated.body.operationId);
    await mutate('patch', `/api/benchmark-tests/${testId}`, adminCookie, {
      evaluationLogic: 'a different pending change',
    }).expect(409);
    await applyTestSnapshot(
      testSnapshot(testId, 2, updateCommand.data.specification),
      updated.body.operationId
    );

    await prisma.catalogEntry.update({
      where: { testId },
      data: { status: BenchmarkValidationStatus.published },
    });
    const publishedCommands = await commandCount(testId);
    await mutate('patch', `/api/benchmark-tests/${testId}`, adminCookie, {
      metrics: [],
    }).expect(400);
    await expect(commandCount(testId)).resolves.toBe(publishedCommands);

    const deleted = await mutate(
      'delete',
      `/api/benchmark-tests/${testId}`,
      superUserCookie
    ).expect(202);
    await expectCommand(deleted.body.operationId, {
      eventType: BENCHMARK_MESSAGE_TYPES.testDeleteRequested,
      aggregateVersion: 2,
      data: { testId, expectedAggregateVersion: 2 },
    });
    await applyTestDeleted(testId, 3, deleted.body.operationId);

    const restored = await mutate(
      'post',
      `/api/benchmark-tests/${testId}/restore`,
      adminCookie
    ).expect(202);
    await expectCommand(restored.body.operationId, {
      eventType: BENCHMARK_MESSAGE_TYPES.testRestoreRequested,
      aggregateVersion: 3,
      data: { testId, expectedAggregateVersion: 3 },
    });
    await applyTestSnapshot(
      testSnapshot(testId, 4, updateCommand.data.specification),
      restored.body.operationId
    );

    await prisma.model.create({
      data: { id: 'remote-write-model', name: 'Remote write model' },
    });
    await mutate('post', '/api/metrics/results', adminCookie, {
      testId,
      metricId: createdSpecification.metricIds[0],
      modelId: 'remote-write-model',
      value: 0.9,
    }).expect(201);
    const commandsBeforeLockDelivery = await commandCount(testId);
    await mutate('patch', `/api/benchmark-tests/${testId}`, adminCookie, {
      description: 'forbidden before Kafka lock delivery',
    }).expect(409);
    await mutate('delete', `/api/benchmark-tests/${testId}`, superUserCookie).expect(409);
    await expect(commandCount(testId)).resolves.toBe(commandsBeforeLockDelivery);

    await applyTestSnapshot({
      ...testSnapshot(testId, 5, updateCommand.data.specification),
      specificationLockedAt: '2026-09-13T05:00:00.000Z',
      specificationLockReason: 'metric_result_created',
    });
    const lockedCommands = await commandCount(testId);
    await mutate('patch', `/api/benchmark-tests/${testId}`, adminCookie, {
      description: 'forbidden',
    }).expect(409);
    await mutate(
      'delete',
      `/api/benchmark-tests/${testId}`,
      superUserCookie
    ).expect(409);
    await expect(commandCount(testId)).resolves.toBe(lockedCommands);
  });

  it('does not save a result against a Test with a queued or processing update', async () => {
    const { testId, specification } = await projectedTestForResults();
    const updated = await mutate('patch', `/api/benchmark-tests/${testId}`, adminCookie, {
      description: 'Pending specification change',
    }).expect(202);
    const result = {
      testId,
      metricId: specification.metricIds[0],
      modelId: 'remote-write-model',
      value: 0.9,
    };
    await mutate('post', '/api/metrics/results', adminCookie, result).expect(409);
    await prisma.outboxMessage.update({
      where: { id: updated.body.operationId },
      data: { publishedAt: new Date() },
    });
    await mutate('post', '/api/metrics/results', adminCookie, result).expect(409);
    await expect(prisma.metricResult.count({ where: { testId } })).resolves.toBe(0);

    await applyTestSnapshot(
      testSnapshot(testId, 2, { ...specification, description: 'Pending specification change' }),
      updated.body.operationId
    );
    await mutate('post', '/api/metrics/results', adminCookie, result).expect(201);
  });

  it.each(['patch', 'delete'] as const)('serializes a first result with a concurrent Test %s', async (method) => {
    const { testId, specification } = await projectedTestForResults();
    const [result, updated] = await Promise.all([
      mutate('post', '/api/metrics/results', adminCookie, {
        testId,
        metricId: specification.metricIds[0],
        modelId: 'remote-write-model',
        value: 0.9,
      }),
      mutate(method, `/api/benchmark-tests/${testId}`,
        'delete' === method ? superUserCookie : adminCookie,
        'patch' === method ? { description: 'Concurrent change' } : undefined),
    ]);
    expect([[201, 409], [409, 202]]).toContainEqual([result.status, updated.status]);
    await expect(prisma.metricResult.count({ where: { testId } })).resolves.toBe(
      201 === result.status ? 1 : 0
    );
    await expect(commandCount(testId)).resolves.toBe(2);
  });

  it('allows a corrected request after rejection without reusing the old failure', async () => {
    const suiteId = randomUUID();
    aggregateIds.add(suiteId);
    await applySnapshot(suiteSnapshot(suiteId, 1));

    const failed = await mutate('patch', `/api/benchmarks/${suiteId}`, adminCookie, {
      name: 'Conflicting name',
    }).expect(202);
    await projection.apply(
      {
        eventId: randomUUID(),
        eventType: BENCHMARK_MESSAGE_TYPES.commandRejected,
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        correlationId: randomUUID(),
        causationId: failed.body.operationId,
        producer: 'benchmark-service',
        aggregateType: 'benchmark',
        aggregateId: suiteId,
        aggregateVersion: 1,
        data: {
          commandEventId: failed.body.operationId,
          reasonCode: 'BENCHMARK_NAME_CONFLICT',
          statusCode: 409,
          message: 'Benchmark with this name already exists',
        },
      },
      metadata()
    );

    const corrected = await mutate('patch', `/api/benchmarks/${suiteId}`, adminCookie, {
      name: 'Available name',
    }).expect(202);
    expect(corrected.body.operationId).not.toBe(failed.body.operationId);
    const repeated = await mutate('patch', `/api/benchmarks/${suiteId}`, adminCookie, {
      name: 'Available name',
    }).expect(202);
    expect(repeated.body.operationId).toBe(corrected.body.operationId);
    await expectCommand(corrected.body.operationId, {
      aggregateVersion: 1,
      data: { specification: { name: 'Available name' } },
    });
    await applySnapshot(
      suiteSnapshot(suiteId, 2, { name: 'Available name' }),
      corrected.body.operationId
    );
    await request(app.getHttpServer())
      .get(`/api/benchmark-operations/${failed.body.operationId}`)
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('rejected'));
    await expect(commandCount(suiteId)).resolves.toBe(2);
  });

  it('removes a provisional CatalogEntry when Test creation is rejected', async () => {
    const suiteId = randomUUID();
    aggregateIds.add(suiteId);
    await prisma.catalogBenchmarkProjection.create({
      data: {
        benchmarkId: suiteId,
        aggregateVersion: 1,
        name: 'Rejection suite',
        nameEn: 'Rejection suite EN',
        sourceCreatedAt: new Date('2026-09-13T00:00:00.000Z'),
        sourceUpdatedAt: new Date('2026-09-13T00:00:00.000Z'),
      },
    });
    const created = await mutate('post', '/api/catalog/submissions', userCookie, {
      suiteId,
      name: 'Conflicting Test',
      nameEn: 'Conflicting Test EN',
      description: 'Will be rejected by the source service',
      metrics: ['remote-write-metric'],
    }).expect(202);
    const testId = created.body.aggregateId as string;
    aggregateIds.add(testId);
    await expect(
      prisma.catalogEntry.findUnique({ where: { testId } })
    ).resolves.not.toBeNull();
    const metric = await prisma.metricDefinition.findUniqueOrThrow({
      where: { name: 'remote-write-metric' },
    });
    await mutate('delete', `/api/metrics/${metric.id}`, adminCookie).expect(409);
    await mutate('delete', `/api/metrics/${metric.id.toUpperCase()}`, adminCookie).expect(409);

    const responseEventId = randomUUID();
    await projection.apply(
      {
        eventId: responseEventId,
        eventType: BENCHMARK_MESSAGE_TYPES.commandRejected,
        eventVersion: 1,
        occurredAt: '2026-09-13T01:00:00.000Z',
        correlationId: randomUUID(),
        causationId: created.body.operationId,
        producer: 'benchmark-service',
        aggregateType: 'test',
        aggregateId: testId,
        aggregateVersion: 1,
        data: {
          commandEventId: created.body.operationId,
          reasonCode: 'TEST_NAME_CONFLICT',
          message: 'Test with this name already exists',
        },
      },
      metadata()
    );

    await expect(
      prisma.catalogEntry.findUnique({ where: { testId } })
    ).resolves.toBeNull();
    await mutate('delete', `/api/metrics/${metric.id}`, adminCookie).expect(204);
    await request(app.getHttpServer())
      .get(`/api/benchmark-operations/${created.body.operationId}`)
      .set('Cookie', userCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: 'rejected',
          reasonCode: 'TEST_NAME_CONFLICT',
        });
      });
  });

  function mutate(
    method: 'post' | 'patch' | 'delete',
    path: string,
    cookie: string,
    body?: object
  ) {
    const call = request(app.getHttpServer())[method](path)
      .set('Cookie', cookie)
      .set('Origin', E2E_ORIGIN);
    return body ? call.send(body) : call;
  }

  async function projectedTestForResults() {
    const suiteId = randomUUID();
    aggregateIds.add(suiteId);
    await applySnapshot(suiteSnapshot(suiteId, 1));
    const created = await mutate('post', '/api/benchmark-tests', adminCookie, {
      suiteId,
      name: 'Result boundary Test',
      nameEn: 'Result boundary Test EN',
      description: 'Test for first result concurrency',
      metrics: ['remote-write-metric'],
    }).expect(202);
    const testId = created.body.aggregateId as string;
    aggregateIds.add(testId);
    const createCommand = await command(created.body.operationId);
    if (BENCHMARK_MESSAGE_TYPES.testCreateRequested !== createCommand.eventType) {
      throw new Error('Expected Test create command');
    }
    const specification = createCommand.data.specification;
    await applyTestSnapshot(testSnapshot(testId, 1, specification), created.body.operationId);
    await prisma.model.create({
      data: { id: 'remote-write-model', name: 'Remote write model' },
    });
    return { testId, specification };
  }

  async function expectCommand(
    operationId: string,
    expected: object
  ): Promise<void> {
    const command = await prisma.outboxMessage.findUniqueOrThrow({
      where: { id: operationId },
    });
    expect(command).toMatchObject({
      topic: KAFKA_TOPICS.benchmarkCommands,
      publishedAt: null,
    });
    expect(command.payload).toMatchObject(expected);
  }

  async function command(operationId: string) {
    const row = await prisma.outboxMessage.findUniqueOrThrow({
      where: { id: operationId },
      select: { payload: true },
    });
    return parseBenchmarkIntegrationMessageV1(row.payload);
  }

  function commandCount(aggregateId: string): Promise<number> {
    return prisma.outboxMessage.count({
      where: { aggregateId, topic: KAFKA_TOPICS.benchmarkCommands },
    });
  }

  async function expectApplied(operationId: string): Promise<void> {
    await request(app.getHttpServer())
      .get(`/api/benchmark-operations/${operationId}`)
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('applied'));
  }

  async function applySnapshot(
    value: BenchmarkSuiteSnapshotV1,
    causationId: string | null = null
  ): Promise<void> {
    await projection.apply(
      {
        eventId: randomUUID(),
        eventType: BENCHMARK_MESSAGE_TYPES.suiteSnapshot,
        eventVersion: 1,
        occurredAt: value.updatedAt,
        correlationId: randomUUID(),
        causationId,
        producer: 'benchmark-service',
        aggregateType: 'benchmark',
        aggregateId: value.id,
        aggregateVersion: value.aggregateVersion,
        data: { benchmark: value },
      },
      metadata()
    );
    if (causationId) await expectApplied(causationId);
  }

  async function applyTestSnapshot(
    value: BenchmarkTestSnapshotV1,
    causationId: string | null = null
  ): Promise<void> {
    await projection.apply(
      {
        eventId: randomUUID(),
        eventType: BENCHMARK_MESSAGE_TYPES.testSnapshot,
        eventVersion: 1,
        occurredAt: value.updatedAt,
        correlationId: randomUUID(),
        causationId,
        producer: 'benchmark-service',
        aggregateType: 'test',
        aggregateId: value.id,
        aggregateVersion: value.aggregateVersion,
        data: { test: value },
      },
      metadata()
    );
    if (causationId) await expectApplied(causationId);
  }

  async function applyTestDeleted(
    testId: string,
    aggregateVersion: number,
    causationId: string
  ): Promise<void> {
    const deletedAt = '2026-09-13T03:00:00.000Z';
    await projection.apply(
      {
        eventId: randomUUID(),
        eventType: BENCHMARK_MESSAGE_TYPES.testDeleted,
        eventVersion: 1,
        occurredAt: deletedAt,
        correlationId: randomUUID(),
        causationId,
        producer: 'benchmark-service',
        aggregateType: 'test',
        aggregateId: testId,
        aggregateVersion,
        data: { testId, deletedAt },
      },
      metadata()
    );
    await expectApplied(causationId);
  }

  async function applyDeleted(
    suiteId: string,
    aggregateVersion: number,
    causationId: string
  ): Promise<void> {
    const deletedAt = '2026-09-13T03:00:00.000Z';
    await projection.apply(
      {
        eventId: randomUUID(),
        eventType: BENCHMARK_MESSAGE_TYPES.suiteDeleted,
        eventVersion: 1,
        occurredAt: deletedAt,
        correlationId: randomUUID(),
        causationId,
        producer: 'benchmark-service',
        aggregateType: 'benchmark',
        aggregateId: suiteId,
        aggregateVersion,
        data: { benchmarkId: suiteId, deletedAt },
      },
      metadata()
    );
    await expectApplied(causationId);
  }

  function metadata() {
    return {
      topic: KAFKA_TOPICS.benchmarkEvents,
      partition: 0,
      offset: String(offset++),
    };
  }

  async function clearFixtures(): Promise<void> {
    if (!aggregateIds.size) return;
    const ids = [...aggregateIds];
    await prisma.benchmarkCommandActor.deleteMany();
    await prisma.benchmarkSearchDocument.deleteMany({
      where: { benchmarkTestId: { in: ids } },
    });
    await prisma.catalogEntry.deleteMany({ where: { testId: { in: ids } } });
    await prisma.metricResult.deleteMany({ where: { testId: { in: ids } } });
    await prisma.benchmarkCommandOutcome.deleteMany({
      where: { aggregateId: { in: ids } },
    });
    await prisma.outboxMessage.deleteMany({
      where: { aggregateId: { in: ids } },
    });
    await prisma.inboxMessage.deleteMany({
      where: { aggregateId: { in: ids } },
    });
    await prisma.catalogTestProjection.deleteMany({
      where: { testId: { in: ids } },
    });
    await prisma.catalogBenchmarkProjection.deleteMany({
      where: { benchmarkId: { in: ids } },
    });
    await prisma.metricDefinition.deleteMany({
      where: { name: 'remote-write-metric' },
    });
    await prisma.model.deleteMany({ where: { id: 'remote-write-model' } });
    aggregateIds.clear();
  }
});

function suiteSnapshot(
  id: string,
  aggregateVersion: number,
  overrides: Partial<BenchmarkSuiteSnapshotV1> = {}
): BenchmarkSuiteSnapshotV1 {
  return {
    id,
    aggregateVersion,
    name: 'Remote write suite',
    nameEn: 'Remote write suite EN',
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: `2026-09-13T0${aggregateVersion}:00:00.000Z`,
    deletedAt: null,
    ...overrides,
  };
}

function testSnapshot(
  id: string,
  aggregateVersion: number,
  specification: BenchmarkTestSnapshotV1['specification']
): BenchmarkTestSnapshotV1 {
  return {
    id,
    aggregateVersion,
    specification,
    specificationLockedAt: null,
    specificationLockReason: null,
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: `2026-09-13T0${aggregateVersion}:00:00.000Z`,
    deletedAt: null,
  };
}
