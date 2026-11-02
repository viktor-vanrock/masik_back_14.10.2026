import { randomUUID } from 'node:crypto';
import { INestApplication, NotFoundException } from '@nestjs/common';
import request from 'supertest';
import {
  BENCHMARK_MESSAGE_TYPES,
  BenchmarkTestSnapshotV1,
} from '@/benchmark-service/contracts/benchmark-integration.v1';
import { CatalogBenchmarkProjectionService } from '@/catalog/projection/catalog-benchmark-projection.service';
import { SortDirection } from '@/common/enums/sortDirection.enum';
import { EXTERNAL_API_KEY_SCOPE } from '@/external-api/api-keys/external-api-key.constants';
import {
  ExternalBenchmarkTestSortColumn,
} from '@/external-api/benchmark-tests/dto/externalBenchmarkTestSearchDto.dto';
import { ExternalBenchmarkTestsService } from '@/external-api/benchmark-tests/external-benchmark-tests.service';
import { ExternalBenchmarkTestField } from '@/external-api/benchmark-tests/types';
import { BenchmarkValidationStatus } from '@/generated/prisma/client';
import { KAFKA_TOPICS } from '@/kafka/kafka.constants';
import { PrismaService } from '@/prisma/prisma.service';
import { VaultTransitService } from '@/vault/vault-transit.service';
import { createE2eApplication } from './support/create-e2e-application';

describe('External Benchmark/Test projection reads (e2e)', () => {
  const suiteId = '71111111-1111-4111-8111-111111111111';
  const deletedSuiteId = '72222222-2222-4222-8222-222222222222';
  const publishedTestId = '73333333-3333-4333-8333-333333333333';
  const secondPublishedTestId = '74444444-4444-4444-8444-444444444444';
  const validationTestId = '75555555-5555-4555-8555-555555555555';
  const hiddenTestId = '76666666-6666-4666-8666-666666666666';
  const archivedTestId = '77777777-7777-4777-8777-777777777777';
  const rawApiKey = `bcb_1234567890abcdef_${'a'.repeat(43)}`;

  let app: INestApplication;
  let prisma: PrismaService;
  let projections: CatalogBenchmarkProjectionService;
  let externalTests: ExternalBenchmarkTestsService;
  let offset = 0;
  let taxonomy: Awaited<ReturnType<typeof createTaxonomy>>;
  let metricId: string;

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
    projections = app.get(CatalogBenchmarkProjectionService);
    externalTests = app.get(ExternalBenchmarkTestsService);
  });

  beforeEach(async () => {
    offset = 0;
    await clearFixtures();
    taxonomy = await createTaxonomy();
    metricId = await createMetric();
    await createProjectionFixtures();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await clearFixtures();
    await app.close();
  });

  it('searches, filters and maps published projections', async () => {
    const result = await externalTests.search({
      filters: {
        search: 'medical',
        benchmarkId: suiteId,
        macroGroup: 'foundational',
        taskType: 'multiple',
        language: 'russ',
        difficulty: 'hard',
        validationStatus: BenchmarkValidationStatus.published,
        knowledgeLevel: 'L2',
        confidentialityLevel: 'internal',
        importance: 'high',
        isGenerated: true,
        skills: ['clinical reasoning'],
        abilityTaxons: ['Reasoning'],
        abilityTags: ['medicine'],
        subGroups: ['Comprehension'],
        domains: ['Medicine'],
        subdomains: ['Diagnostics'],
        modalities: ['Text'],
        metricNames: ['projection-accuracy'],
        linkTypes: ['dataset'],
        sizeInSamples: { gte: 100, lte: 100 },
        medianSampleSizeWords: { gte: 20, lte: 20 },
        confidenceScore: { gte: 0.9, lte: 1 },
        createdAt: {
          gte: '2026-09-09T00:00:00.000Z',
          lte: '2026-09-11T00:00:00.000Z',
        },
        updatedAt: {
          gte: '2026-09-11T00:00:00.000Z',
          lte: '2026-09-13T00:00:00.000Z',
        },
        generatedAt: {
          gte: '2026-09-11T08:00:00.000Z',
          lte: '2026-09-11T10:00:00.000Z',
        },
      },
      pagination: { page: 1, limit: 10 },
      sort: {
        column: ExternalBenchmarkTestSortColumn.Name,
        direction: SortDirection.Asc,
      },
    });

    expect(result).toMatchObject({
      total: 1,
      page: 1,
      limit: 10,
      data: [
        {
          id: publishedTestId,
          benchmark: {
            id: suiteId,
            name: 'Projection Medical Suite',
            nameEn: 'Projection Medical Suite EN',
            description: 'Projected suite description',
          },
          name: 'Projection Medical Test',
          nameEn: 'Projection Medical Test EN',
          description: 'Medical projection content',
          shortDescription: 'Medical short description',
          taskDescription: 'Choose a diagnosis',
          taskType: 'Multiple Choice',
          language: 'Russian',
          difficulty: 'Hard',
          sizeInSamples: 100,
          medianSampleSizeWords: 20,
          validationStatus: BenchmarkValidationStatus.published,
          taxonomy: {
            macroGroup: 'Text Foundational',
            subGroups: ['Comprehension'],
            skills: ['clinical reasoning'],
            abilityTaxons: ['Reasoning'],
            abilityTags: ['medicine'],
            domains: ['Medicine'],
            subdomains: ['Diagnostics'],
            modalities: ['Text'],
          },
          metrics: [
            {
              id: metricId,
              name: 'projection-accuracy',
              displayName: 'Projection Accuracy',
              priority: 'projection-primary',
              direction: 'projection-higher',
            },
          ],
          gigaMetrics: {
            codebaseUrl: 'https://example.test/code',
            adapterName: 'medical_adapter',
            setUrl: 'https://example.test/set',
            launchCommand: 'evaluate medical',
          },
          links: [
            {
              type: 'dataset',
              title: 'Dataset',
              url: 'https://example.test/dataset',
            },
          ],
          createdAt: '2026-09-10T10:00:00.000Z',
          updatedAt: '2026-09-12T10:00:00.000Z',
        },
      ],
    });

    await expect(
      externalTests.search({ filters: { search: publishedTestId } })
    ).resolves.toMatchObject({ total: 1 });
    await expect(
      externalTests.search({ filters: { search: suiteId } })
    ).resolves.toMatchObject({ total: 2 });
    await expect(
      externalTests.search({ filters: { benchmarkId: 'not-a-uuid' } })
    ).rejects.toThrow('benchmarkId must be a valid UUID');
    await expect(
      externalTests.search({
        filters: { validationStatus: BenchmarkValidationStatus.rejected },
      })
    ).resolves.toMatchObject({ total: 0, data: [] });
  });

  it('serves projections through the authenticated external HTTP contract', async () => {
    const vault = app.get(VaultTransitService);
    const verifyHmac = jest
      .spyOn(vault, 'verifyHmac')
      .mockResolvedValue(true);
    const owner = await prisma.user.create({
      data: {
        username: 'projection-external-owner',
        email: 'projection-external-owner@example.test',
        password: 'not-used',
      },
    });
    await prisma.externalApiKey.create({
      data: {
        name: 'Projection E2E key',
        prefix: 'bcb_1234567890abcdef',
        hmac: 'vault:v1:projection-signature',
        scopes: [EXTERNAL_API_KEY_SCOPE.BENCHMARK_TESTS_READ],
        ownerId: owner.id,
      },
    });

    await request(app.getHttpServer())
      .post('/api/external/v1/benchmark-tests/search')
      .set('x-api-key', rawApiKey)
      .send({ filters: { search: 'Projection Medical Test' } })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          total: 1,
          data: [{ id: publishedTestId, name: 'Projection Medical Test' }],
        });
      });
    await request(app.getHttpServer())
      .get(`/api/external/v1/benchmark-tests/${validationTestId}`)
      .set('x-api-key', rawApiKey)
      .expect(404);
    expect(verifyHmac).toHaveBeenCalledWith(
      rawApiKey,
      'vault:v1:projection-signature'
    );
  });

  it('keeps Catalog moderation and parent lifecycle authoritative', async () => {
    await expect(externalTests.findById(publishedTestId)).resolves.toMatchObject({
      id: publishedTestId,
      name: 'Projection Medical Test',
    });
    for (const hiddenId of [
      validationTestId,
      hiddenTestId,
      archivedTestId,
    ]) {
      await expect(externalTests.findById(hiddenId)).rejects.toBeInstanceOf(
        NotFoundException
      );
    }

    const pageOne = await externalTests.search({
      pagination: { page: 1, limit: 1 },
      sort: {
        column: ExternalBenchmarkTestSortColumn.Name,
        direction: SortDirection.Asc,
      },
    });
    const pageTwo = await externalTests.search({
      pagination: { page: 2, limit: 1 },
      sort: {
        column: ExternalBenchmarkTestSortColumn.Name,
        direction: SortDirection.Asc,
      },
    });
    expect(pageOne).toMatchObject({
      total: 2,
      data: [{ id: secondPublishedTestId }],
    });
    expect(pageTwo).toMatchObject({
      total: 2,
      data: [{ id: publishedTestId }],
    });
  });

  it('derives distinct field values from visible projections and active dictionaries', async () => {
    await expect(
      externalTests.getFieldValues(ExternalBenchmarkTestField.Name)
    ).resolves.toEqual({
      field: ExternalBenchmarkTestField.Name,
      values: ['Another Published Test', 'Projection Medical Test'],
    });
    await expect(
      externalTests.getFieldValues(ExternalBenchmarkTestField.Skills)
    ).resolves.toEqual({
      field: ExternalBenchmarkTestField.Skills,
      values: ['clinical reasoning', 'visible secondary skill'],
    });
    await expect(
      externalTests.getFieldValues(ExternalBenchmarkTestField.MetricNames)
    ).resolves.toEqual({
      field: ExternalBenchmarkTestField.MetricNames,
      values: ['projection-accuracy'],
    });
    await expect(
      externalTests.getFieldValues(ExternalBenchmarkTestField.LinkTypes)
    ).resolves.toEqual({
      field: ExternalBenchmarkTestField.LinkTypes,
      values: ['dataset'],
    });
    await expect(
      externalTests.getFieldValues(ExternalBenchmarkTestField.Language)
    ).resolves.toEqual({
      field: ExternalBenchmarkTestField.Language,
      values: ['Russian'],
    });
  });

  async function createProjectionFixtures(): Promise<void> {
    await applySuite(suiteId, 'Projection Medical Suite');
    await applyTest(
      snapshot(publishedTestId, {
        name: 'Projection Medical Test',
        nameEn: 'Projection Medical Test EN',
        description: 'Medical projection content',
        shortDescription: 'Medical short description',
        taskDescription: 'Choose a diagnosis',
        macroGroupId: taxonomy.macroGroupId,
        subGroupIds: [taxonomy.subGroupId],
        abilityTaxonIds: [taxonomy.abilityTaxonId],
        taskTypeId: taxonomy.taskTypeId,
        modalityIds: [taxonomy.modalityId],
        languageId: taxonomy.languageId,
        difficultyId: taxonomy.difficultyId,
        domainIds: [taxonomy.domainId],
        subdomainIds: [taxonomy.subdomainId],
        abilityTags: ['medicine'],
        skills: ['clinical reasoning'],
        metricIds: [metricId],
        links: [
          {
            type: 'dataset',
            title: 'Dataset',
            url: 'https://example.test/dataset',
          },
        ],
        sizeInSamples: 100,
        medianSampleSizeWords: 20,
        confidenceScore: 0.95,
        confidentialityLevel: 'internal',
        knowledgeLevel: 'L2',
        importance: 'high',
        gigaMetricsCodebaseUrl: 'https://example.test/code',
        gigaMetricAdapterName: 'medical_adapter',
        gigaMetricSetUrl: 'https://example.test/set',
        gigaMetricLaunchCommand: 'evaluate medical',
        isGenerated: true,
        generatedAt: '2026-09-11T09:00:00.000Z',
      })
    );
    await applyTest(
      snapshot(secondPublishedTestId, {
        name: 'Another Published Test',
        nameEn: 'Another Published Test EN',
        skills: ['visible secondary skill'],
      })
    );
    await applyTest(
      snapshot(validationTestId, {
        name: 'Validation Test',
        skills: ['validation-only skill'],
      })
    );
    await applyTest(
      snapshot(archivedTestId, {
        name: 'Archived Test',
        skills: ['archived-only skill'],
      })
    );
    await applySuite(deletedSuiteId, 'Deleted Projection Suite');
    await applyTest(
      snapshot(hiddenTestId, {
        suiteId: deletedSuiteId,
        name: 'Deleted Parent Test',
        skills: ['deleted-parent-only skill'],
      })
    );
    await deleteSuite(deletedSuiteId);

    await prisma.catalogEntry.createMany({
      data: [
        {
          testId: publishedTestId,
          status: BenchmarkValidationStatus.published,
        },
        {
          testId: secondPublishedTestId,
          status: BenchmarkValidationStatus.published,
        },
        {
          testId: validationTestId,
          status: BenchmarkValidationStatus.validation,
        },
        {
          testId: hiddenTestId,
          status: BenchmarkValidationStatus.published,
        },
        {
          testId: archivedTestId,
          status: BenchmarkValidationStatus.published,
          archivedAt: new Date('2026-09-12T15:00:00.000Z'),
        },
      ],
    });
  }

  async function createTaxonomy() {
    const macroGroup = await prisma.dictMacroGroup.create({
      data: {
        name: 'Text Foundational',
        nameEn: 'Text Foundational EN',
      },
    });
    const subGroup = await prisma.dictSubGroup.create({
      data: {
        macroGroupId: macroGroup.id,
        name: 'Comprehension',
        nameEn: 'Comprehension EN',
      },
    });
    const abilityTaxon = await prisma.dictAbilityTaxon.create({
      data: { name: 'Reasoning', nameEn: 'Reasoning EN' },
    });
    const taskType = await prisma.dictTaskType.create({
      data: { name: 'Multiple Choice', nameEn: 'Multiple Choice EN' },
    });
    const modality = await prisma.dictModality.create({
      data: { name: 'Text', nameEn: 'Text EN' },
    });
    const language = await prisma.dictLanguage.create({
      data: { name: 'Russian', nameEn: 'Russian EN' },
    });
    await prisma.dictLanguage.create({
      data: {
        name: 'Deleted Language',
        nameEn: 'Deleted Language EN',
        deletedAt: new Date(),
      },
    });
    const difficulty = await prisma.dictDifficulty.create({
      data: { name: 'Hard', nameEn: 'Hard EN' },
    });
    const domain = await prisma.dictDomain.create({
      data: { name: 'Medicine', nameEn: 'Medicine EN' },
    });
    const subdomain = await prisma.dictSubdomain.create({
      data: {
        domainId: domain.id,
        name: 'Diagnostics',
        nameEn: 'Diagnostics EN',
      },
    });
    return {
      macroGroupId: macroGroup.id,
      subGroupId: subGroup.id,
      abilityTaxonId: abilityTaxon.id,
      taskTypeId: taskType.id,
      modalityId: modality.id,
      languageId: language.id,
      difficultyId: difficulty.id,
      domainId: domain.id,
      subdomainId: subdomain.id,
    };
  }

  async function createMetric(): Promise<string> {
    const priority = await prisma.metricPriorityLookup.upsert({
      where: { code: 'projection-primary' },
      update: {},
      create: { code: 'projection-primary', name: 'Projection Primary' },
    });
    const direction = await prisma.metricDirectionLookup.upsert({
      where: { code: 'projection-higher' },
      update: {},
      create: { code: 'projection-higher', name: 'Projection Higher' },
    });
    const metric = await prisma.metricDefinition.create({
      data: {
        name: 'projection-accuracy',
        displayName: 'Projection Accuracy',
        priorityId: priority.id,
        directionId: direction.id,
      },
    });
    return metric.id;
  }

  async function applySuite(id: string, name: string): Promise<void> {
    await projections.apply(
      {
        eventId: randomUUID(),
        eventType: BENCHMARK_MESSAGE_TYPES.suiteSnapshot,
        eventVersion: 1,
        occurredAt: '2026-09-12T12:00:00.000Z',
        correlationId: randomUUID(),
        causationId: null,
        producer: 'benchmark-service',
        aggregateType: 'benchmark',
        aggregateId: id,
        aggregateVersion: 1,
        data: {
          benchmark: {
            id,
            aggregateVersion: 1,
            name,
            nameEn: `${name} EN`,
            description: 'Projected suite description',
            descriptionEn: 'Projected suite description EN',
            createdAt: '2026-09-10T10:00:00.000Z',
            updatedAt: '2026-09-12T10:00:00.000Z',
            deletedAt: null,
          },
        },
      },
      metadata()
    );
  }

  async function applyTest(value: BenchmarkTestSnapshotV1): Promise<void> {
    await projections.apply(
      {
        eventId: randomUUID(),
        eventType: BENCHMARK_MESSAGE_TYPES.testSnapshot,
        eventVersion: 1,
        occurredAt: '2026-09-12T12:00:00.000Z',
        correlationId: randomUUID(),
        causationId: null,
        producer: 'benchmark-service',
        aggregateType: 'test',
        aggregateId: value.id,
        aggregateVersion: value.aggregateVersion,
        data: { test: value },
      },
      metadata()
    );
  }

  async function deleteSuite(id: string): Promise<void> {
    await projections.apply(
      {
        eventId: randomUUID(),
        eventType: BENCHMARK_MESSAGE_TYPES.suiteDeleted,
        eventVersion: 1,
        occurredAt: '2026-09-12T14:00:00.000Z',
        correlationId: randomUUID(),
        causationId: null,
        producer: 'benchmark-service',
        aggregateType: 'benchmark',
        aggregateId: id,
        aggregateVersion: 2,
        data: { benchmarkId: id, deletedAt: '2026-09-12T14:00:00.000Z' },
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
    await prisma.metricUploadRow.deleteMany();
    await prisma.metricResult.deleteMany();
    await prisma.inboxMessage.deleteMany({
      where: { topic: KAFKA_TOPICS.benchmarkEvents },
    });
    await prisma.catalogEntry.deleteMany();
    await prisma.externalApiKey.deleteMany();
    await prisma.user.deleteMany();
    await prisma.catalogTestProjection.deleteMany();
    await prisma.catalogBenchmarkProjection.deleteMany();
    await prisma.metricDefinition.deleteMany({
      where: { name: 'projection-accuracy' },
    });
    await prisma.metricPriorityLookup.deleteMany({
      where: { code: 'projection-primary' },
    });
    await prisma.metricDirectionLookup.deleteMany({
      where: { code: 'projection-higher' },
    });
    await prisma.dictSubdomain.deleteMany();
    await prisma.dictDomain.deleteMany();
    await prisma.dictSubGroup.deleteMany();
    await prisma.dictMacroGroup.deleteMany();
    await prisma.dictAbilityTaxon.deleteMany();
    await prisma.dictTaskType.deleteMany();
    await prisma.dictModality.deleteMany();
    await prisma.dictLanguage.deleteMany();
    await prisma.dictDifficulty.deleteMany();
  }
});

function snapshot(
  id: string,
  overrides: Partial<BenchmarkTestSnapshotV1['specification']> = {}
): BenchmarkTestSnapshotV1 {
  return {
    id,
    aggregateVersion: 1,
    specification: {
      suiteId: '71111111-1111-4111-8111-111111111111',
      name: 'Projection Test',
      nameEn: 'Projection Test EN',
      description: 'Projection content',
      subGroupIds: [],
      abilityTaxonIds: [],
      modalityIds: [],
      capabilityIds: [],
      domainIds: [],
      subdomainIds: [],
      abilityTags: [],
      skills: [],
      metricIds: [],
      examples: [{ input: 'input', output: 'output' }],
      datasetSubsamples: [],
      references: [],
      links: [],
      sizeInSamples: 10,
      medianSampleSizeWords: 5,
      requestLengthDist: { min: 1, median: 2, max: 3 },
      responseLengthDist: { min: 2, median: 3, max: 4 },
      isDifficultyAutoCalculated: false,
      isGenerated: false,
      ...overrides,
    },
    specificationLockedAt: null,
    specificationLockReason: null,
    createdAt: '2026-09-10T10:00:00.000Z',
    updatedAt: '2026-09-12T10:00:00.000Z',
    deletedAt: null,
  };
}
