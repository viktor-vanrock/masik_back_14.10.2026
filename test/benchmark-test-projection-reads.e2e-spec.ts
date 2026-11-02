import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  BENCHMARK_MESSAGE_TYPES,
  BenchmarkTestSnapshotV1,
} from '@/benchmark-service/contracts/benchmark-integration.v1';
import { BenchmarkTestReadScope } from '@/catalog/benchmark-test/benchmark-test-read-scope';
import { BenchmarkTestService } from '@/catalog/benchmark-test/benchmark-test.service';
import { BenchmarkSortColumn } from '@/catalog/benchmark-test/dto/benchmarkTestQuery.dto';
import { CatalogBenchmarkProjectionService } from '@/catalog/projection/catalog-benchmark-projection.service';
import { CatalogTestProjectionQueryService } from '@/catalog/projection/catalog-test-projection-query.service';
import { SortDirection } from '@/common/enums/sortDirection.enum';
import { BenchmarkValidationStatus } from '@/generated/prisma/client';
import { KAFKA_TOPICS } from '@/kafka/kafka.constants';
import { PrismaService } from '@/prisma/prisma.service';
import { createE2eApplication } from './support/create-e2e-application';

describe('Benchmark Test projection reads (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let projection: CatalogBenchmarkProjectionService;
  let queryService: CatalogTestProjectionQueryService;
  let benchmarkTests: BenchmarkTestService;
  let offset = 0;
  const suiteId = '11111111-1111-4111-8111-111111111111';
  const firstTestId = '22222222-2222-4222-8222-222222222222';
  const secondTestId = '33333333-3333-4333-8333-333333333333';

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
    projection = app.get(CatalogBenchmarkProjectionService);
    queryService = app.get(CatalogTestProjectionQueryService);
    benchmarkTests = app.get(BenchmarkTestService);
  });

  beforeEach(async () => {
    offset = 0;
    await clearFixtures();
  });

  afterAll(async () => {
    await clearFixtures();
    await app.close();
  });

  it('serves a complete Test from Kafka projections', async () => {
    await applySuite(suiteId, 'Projected Suite');
    await applyTest(
      snapshot(firstTestId, {
        name: 'Projected Test',
        evaluationLogic: 'exact match',
        humanBaseline: 0.97,
        generatedAt: '2026-09-11T09:00:00.000Z',
        datasetSubsamples: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            name: 'public',
            nameEn: 'public',
            split: 'test',
            sizeInSamples: 5,
            medianSampleSizeWords: 3,
            requestLengthDist: distribution(1, 2, 3),
            responseLengthDist: distribution(1, 1, 2),
            examples: [{ input: 'subsample input', output: 'subsample output' }],
          },
        ],
      })
    );

    const result = await benchmarkTests.findAllForManagement({
      page: 1,
      limit: 10,
      search: 'projected suite',
    });
    expect(result).toMatchObject({
      total: 1,
      data: [
        {
          id: firstTestId,
          suiteId,
          name: 'Projected Test',
          evaluationLogic: 'exact match',
          humanBaseline: 0.97,
          generatedAt: '2026-09-11T09:00:00.000Z',
          validationStatus: undefined,
          datasetSubsamples: [
            {
              id: '44444444-4444-4444-8444-444444444444',
              split: 'test',
              examples: [
                { input: 'subsample input', output: 'subsample output' },
              ],
            },
          ],
        },
      ],
    });

    const stored = await prisma.catalogTestProjection.findUniqueOrThrow({
      where: { testId: firstTestId },
    });
    expect(stored).toMatchObject({
      name: 'Projected Test',
      sizeInSamples: 100,
      sourceCreatedAt: new Date('2026-09-11T10:00:00.000Z'),
    });

    for (const search of ['%', '_', '\u0027 OR TRUE --']) {
      await expect(
        benchmarkTests.findAllForManagement({ page: 1, limit: 10, search })
      ).resolves.toMatchObject({ total: 0, data: [] });
    }
  });

  it('builds every filter option from projected Test data', async () => {
    const macroGroup = await prisma.dictMacroGroup.create({
      data: { name: 'Macro', nameEn: 'Macro EN' },
    });
    const subGroup = await prisma.dictSubGroup.create({
      data: {
        macroGroupId: macroGroup.id,
        name: 'Subgroup',
        nameEn: 'Subgroup EN',
      },
    });
    const abilityTaxon = await prisma.dictAbilityTaxon.create({
      data: { name: 'Ability', nameEn: 'Ability EN' },
    });
    const taskType = await prisma.dictTaskType.create({
      data: { name: 'Task', nameEn: 'Task EN' },
    });
    const modality = await prisma.dictModality.create({
      data: { name: 'Modality', nameEn: 'Modality EN' },
    });
    const language = await prisma.dictLanguage.create({
      data: { name: 'Language', nameEn: 'Language EN' },
    });
    const difficulty = await prisma.dictDifficulty.create({
      data: { name: 'Difficulty', nameEn: 'Difficulty EN' },
    });
    const capability = await prisma.dictCapability.create({
      data: { name: 'Capability', nameEn: 'Capability EN' },
    });
    const domain = await prisma.dictDomain.create({
      data: { name: 'Domain', nameEn: 'Domain EN' },
    });
    const subdomain = await prisma.dictSubdomain.create({
      data: {
        domainId: domain.id,
        name: 'Subdomain',
        nameEn: 'Subdomain EN',
      },
    });

    await applySuite(suiteId, 'Filter Suite');
    await applyTest(
      snapshot(firstTestId, {
        skills: ['projection-skill'],
        abilityTags: ['projection-tag'],
      })
    );
    await prisma.catalogEntry.create({
      data: {
        testId: firstTestId,
        status: BenchmarkValidationStatus.published,
      },
    });

    await request(app.getHttpServer())
      .get('/api/benchmark-tests/filters/options')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          macroGroups: [expect.objectContaining({ id: macroGroup.id })],
          subGroups: [
            expect.objectContaining({
              id: subGroup.id,
              macroGroupId: macroGroup.id,
            }),
          ],
          abilityTaxons: [expect.objectContaining({ id: abilityTaxon.id })],
          taskTypes: [expect.objectContaining({ id: taskType.id })],
          modalities: [expect.objectContaining({ id: modality.id })],
          languages: [expect.objectContaining({ id: language.id })],
          difficulties: [expect.objectContaining({ id: difficulty.id })],
          capabilities: [expect.objectContaining({ id: capability.id })],
          domains: [expect.objectContaining({ id: domain.id })],
          subdomains: [
            expect.objectContaining({
              id: subdomain.id,
              domainId: domain.id,
            }),
          ],
          skills: ['projection-skill'],
          abilityTags: ['projection-tag'],
        });
      });
  });

  it('keeps Catalog publication authoritative while reading content from projection', async () => {
    await createPublicationEntries();
    const metricId = await createMetricFixtures();
    await applySuite(suiteId, 'Remote Suite');
    await applyTest(
      snapshot(firstTestId, {
        name: 'Remote Published',
        metricIds: [metricId],
        skills: ['projected-skill'],
        abilityTags: ['projected-tag'],
      })
    );
    await applyTest(snapshot(secondTestId, { name: 'Remote Validation' }));

    const list = await request(app.getHttpServer())
      .get('/api/benchmark-tests?page=1&limit=10')
      .expect(200);
    expect(list.body).toMatchObject({
      total: 1,
      data: [{ id: firstTestId, name: 'Remote Published' }],
    });

    await request(app.getHttpServer())
      .get(`/api/benchmark-tests/${firstTestId}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: firstTestId,
          name: 'Remote Published',
          validationStatus: BenchmarkValidationStatus.published,
          metrics: ['accuracy'],
          scores: [
            expect.objectContaining({
              modelId: 'projection-model',
              metricId,
              score: 0.91,
            }),
          ],
        });
        expect(body).not.toHaveProperty('catalogEntry');
      });
    await request(app.getHttpServer())
      .get(`/api/benchmark-tests/${secondTestId}`)
      .expect(404);

    await request(app.getHttpServer())
      .get('/api/benchmark-tests/filters/options')
      .expect(200)
      .expect(({ body }) => {
        expect(body.skills).toEqual(['projected-skill']);
        expect(body.abilityTags).toEqual(['projected-tag']);
      });

    const management = await benchmarkTests.findAllForManagement({
      page: 1,
      limit: 10,
    });
    expect(management.total).toBe(2);
    expect(management.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstTestId,
          catalogEntry: expect.objectContaining({
            status: BenchmarkValidationStatus.published,
          }),
        }),
        expect.objectContaining({
          id: secondTestId,
          catalogEntry: expect.objectContaining({
            status: BenchmarkValidationStatus.validation,
          }),
        }),
      ])
    );
  });

  it('filters and sorts on indexed projection fields and hides deleted parents', async () => {
    const easyId = randomUUID();
    const hardId = randomUUID();
    const languageId = randomUUID();
    const domainId = randomUUID();
    await prisma.dictDifficulty.createMany({
      data: [
        { id: easyId, name: 'A Easy', nameEn: 'A Easy' },
        { id: hardId, name: 'Z Hard', nameEn: 'Z Hard' },
      ],
    });
    await prisma.dictLanguage.create({
      data: { id: languageId, name: 'Русский', nameEn: 'Russian' },
    });
    await prisma.dictDomain.create({
      data: { id: domainId, name: 'Математика', nameEn: 'Math' },
    });

    await applySuite(suiteId, 'Sortable Suite');
    await applyTest(
      snapshot(firstTestId, {
        name: 'Hard Test',
        difficultyId: hardId,
        languageId,
        domainIds: [domainId],
        skills: ['reasoning'],
        sizeInSamples: 200,
      })
    );
    await applyTest(
      snapshot(secondTestId, {
        name: 'Easy Test',
        difficultyId: easyId,
        languageId,
        sizeInSamples: 20,
      })
    );

    const filtered = await queryService.findAll(
      {
        page: 1,
        limit: 10,
        domainIds: [domainId],
        languageIds: [languageId],
        skills: ['reasoning'],
        sizeMin: 100,
        sizeMax: 250,
      },
      BenchmarkTestReadScope.Management
    );
    expect(filtered).toMatchObject({
      total: 1,
      data: [
        {
          id: firstTestId,
          difficulty: { id: hardId, name: 'Z Hard' },
          language: { id: languageId, name: 'Русский' },
          domains: [{ id: domainId, name: 'Математика' }],
        },
      ],
    });

    const sorted = await benchmarkTests.findAllForManagement({
      page: 1,
      limit: 10,
      sortColumn: BenchmarkSortColumn.Difficulty,
      sortDirection: SortDirection.Asc,
    });
    expect(sorted.data.map(({ id }) => id)).toEqual([
      secondTestId,
      firstTestId,
    ]);

    await projection.apply(
      {
        eventId: randomUUID(),
        eventType: BENCHMARK_MESSAGE_TYPES.suiteDeleted,
        eventVersion: 1,
        occurredAt: '2026-09-11T14:00:00.000Z',
        correlationId: randomUUID(),
        causationId: null,
        producer: 'benchmark-service',
        aggregateType: 'benchmark',
        aggregateId: suiteId,
        aggregateVersion: 2,
        data: {
          benchmarkId: suiteId,
          deletedAt: '2026-09-11T14:00:00.000Z',
        },
      },
      metadata()
    );
    await expect(
      benchmarkTests.findAllForManagement({ page: 1, limit: 10 })
    ).resolves.toMatchObject({ total: 0, data: [] });
  });

  it('preserves grouped Catalog search semantics and pagination by suites', async () => {
    const secondSuiteId = '55555555-5555-4555-8555-555555555555';
    const thirdTestId = '66666666-6666-4666-8666-666666666666';
    await createGroupedPublicationEntries(thirdTestId);
    await applySuite(
      suiteId,
      'Searchable Remote Suite',
      '2026-09-10T10:00:00.000Z'
    );
    await applySuite(
      secondSuiteId,
      'Other Remote Suite',
      '2026-09-12T10:00:00.000Z'
    );
    await applyTest(snapshot(firstTestId, { name: 'Alpha Remote Test' }));
    await applyTest(snapshot(secondTestId, { name: 'Beta Remote Test' }));
    await applyTest(
      snapshot(thirdTestId, {
        suiteId: secondSuiteId,
        name: 'Needle Remote Test',
      })
    );

    const suiteSearch = await request(app.getHttpServer())
      .get('/api/catalog?search=Searchable&page=1&limit=10')
      .expect(200);
    expect(suiteSearch.body).toMatchObject({
      total: 1,
      data: [
        {
          benchmark: {
            id: suiteId,
            benchmarkTestsCount: 2,
            matchedTestsCount: 2,
          },
        },
      ],
    });
    expect(suiteSearch.body.data[0].tests).toHaveLength(2);

    const testSearch = await request(app.getHttpServer())
      .get('/api/catalog?search=Needle&page=1&limit=10')
      .expect(200);
    expect(testSearch.body).toMatchObject({
      total: 1,
      data: [
        {
          benchmark: {
            id: secondSuiteId,
            benchmarkTestsCount: 1,
            matchedTestsCount: 1,
          },
          tests: [{ id: thirdTestId, name: 'Needle Remote Test' }],
        },
      ],
    });

    const firstPage = await request(app.getHttpServer())
      .get('/api/catalog?page=1&limit=1')
      .expect(200);
    const secondPage = await request(app.getHttpServer())
      .get('/api/catalog?page=2&limit=1')
      .expect(200);
    expect(firstPage.body).toMatchObject({
      total: 2,
      data: [{ benchmark: { id: secondSuiteId }, tests: [{ id: thirdTestId }] }],
    });
    expect(secondPage.body.total).toBe(2);
    expect(secondPage.body.data[0].benchmark.id).toBe(suiteId);
    expect(secondPage.body.data[0].tests).toHaveLength(2);
  });

  async function clearFixtures(): Promise<void> {
    await prisma.metricUploadRow.deleteMany();
    await prisma.metricResult.deleteMany();
    await prisma.inboxMessage.deleteMany({
      where: { topic: KAFKA_TOPICS.benchmarkEvents },
    });
    await prisma.catalogTestProjection.deleteMany();
    await prisma.catalogBenchmarkProjection.deleteMany();
    await prisma.catalogEntry.deleteMany();
    await prisma.metricDefinition.deleteMany();
    await prisma.model.deleteMany();
    await prisma.metricPriorityLookup.deleteMany();
    await prisma.metricDirectionLookup.deleteMany();
    await prisma.dictSubdomain.deleteMany();
    await prisma.dictDomain.deleteMany();
    await prisma.dictSubGroup.deleteMany();
    await prisma.dictMacroGroup.deleteMany();
    await prisma.dictAbilityTaxon.deleteMany();
    await prisma.dictTaskType.deleteMany();
    await prisma.dictModality.deleteMany();
    await prisma.dictLanguage.deleteMany();
    await prisma.dictDifficulty.deleteMany();
    await prisma.dictCapability.deleteMany();
  }

  async function createPublicationEntries(): Promise<void> {
    await prisma.catalogEntry.createMany({
      data: [
        {
          testId: firstTestId,
          status: BenchmarkValidationStatus.published,
        },
        {
          testId: secondTestId,
          status: BenchmarkValidationStatus.validation,
        },
      ],
    });
  }

  async function createGroupedPublicationEntries(
    thirdTestId: string
  ): Promise<void> {
    await prisma.catalogEntry.createMany({
      data: [firstTestId, secondTestId, thirdTestId].map((testId) => ({
        testId,
        status: BenchmarkValidationStatus.published,
      })),
    });
  }

  async function createMetricFixtures(): Promise<string> {
    const priority = await prisma.metricPriorityLookup.create({
      data: { code: 'projection-primary', name: 'Primary' },
    });
    const direction = await prisma.metricDirectionLookup.create({
      data: { code: 'projection-higher', name: 'Higher' },
    });
    const metric = await prisma.metricDefinition.create({
      data: {
        name: 'accuracy',
        priorityId: priority.id,
        directionId: direction.id,
      },
    });
    await prisma.model.createMany({
      data: [
        { id: 'projection-model', name: 'Projection Model' },
        { id: 'human', name: 'Human' },
      ],
    });
    await prisma.metricResult.createMany({
      data: [
        {
          benchmarkId: suiteId,
          testId: firstTestId,
          metricId: metric.id,
          modelId: 'projection-model',
          value: 0.91,
          obtainedAt: new Date('2026-09-11T13:00:00.000Z'),
        },
        {
          benchmarkId: suiteId,
          testId: firstTestId,
          metricId: metric.id,
          modelId: 'human',
          value: 0.99,
          obtainedAt: new Date('2026-09-11T13:00:00.000Z'),
        },
      ],
    });
    return metric.id;
  }

  async function applySuite(
    id: string,
    name: string,
    createdAt = '2026-09-11T10:00:00.000Z'
  ): Promise<void> {
    await projection.apply(
      {
        eventId: randomUUID(),
        eventType: BENCHMARK_MESSAGE_TYPES.suiteSnapshot,
        eventVersion: 1,
        occurredAt: '2026-09-11T12:00:00.000Z',
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
            description: `${name} description`,
            createdAt,
            updatedAt: '2026-09-11T12:00:00.000Z',
            deletedAt: null,
          },
        },
      },
      metadata()
    );
  }

  async function applyTest(value: BenchmarkTestSnapshotV1): Promise<void> {
    await projection.apply(
      {
        eventId: randomUUID(),
        eventType: BENCHMARK_MESSAGE_TYPES.testSnapshot,
        eventVersion: 1,
        occurredAt: '2026-09-11T12:00:00.000Z',
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

  function metadata() {
    return {
      topic: KAFKA_TOPICS.benchmarkEvents,
      partition: 0,
      offset: String(offset++),
    };
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
      suiteId: '11111111-1111-4111-8111-111111111111',
      name: 'Projected Test',
      nameEn: 'Projected Test EN',
      description: 'Remote Test content',
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
      sizeInSamples: 100,
      medianSampleSizeWords: 10,
      requestLengthDist: distribution(1, 2, 3),
      responseLengthDist: distribution(2, 3, 4),
      isDifficultyAutoCalculated: false,
      isGenerated: false,
      ...overrides,
    },
    specificationLockedAt: null,
    specificationLockReason: null,
    createdAt: '2026-09-11T10:00:00.000Z',
    updatedAt: '2026-09-11T12:00:00.000Z',
    deletedAt: null,
  };
}

function distribution(min: number, median: number, max: number) {
  return { min, median, max };
}
