import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import {
  BENCHMARK_MESSAGE_TYPES,
  BenchmarkTestSnapshotV1,
} from '@/benchmark-service/contracts/benchmark-integration.v1';
import { CatalogBenchmarkProjectionService } from '@/catalog/projection/catalog-benchmark-projection.service';
import { BenchmarkSearchRepository } from '@/catalog/search/benchmark-search.repository';
import { BenchmarkSearchService } from '@/catalog/search/benchmark-search.service';
import { EmbeddingService } from '@/catalog/search/embedding.service';
import { BenchmarkValidationStatus, Prisma } from '@/generated/prisma/client';
import { KAFKA_TOPICS } from '@/kafka/kafka.constants';
import { PrismaService } from '@/prisma/prisma.service';
import { IRecommendationRequestsRepository } from '@/recommendations/repository/recommendation-requests.repository.interface';
import { createE2eApplication } from './support/create-e2e-application';

describe('Search benchmark-service projection boundary (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let projection: CatalogBenchmarkProjectionService;
  let search: BenchmarkSearchService;
  let repository: BenchmarkSearchRepository;
  let embeddings: EmbeddingService;
  let recommendationRequests: IRecommendationRequestsRepository;
  let offset = 0;
  const suiteId = '11111111-1111-4111-8111-111111111111';
  const testId = '22222222-2222-4222-8222-222222222222';
  const otherSuiteId = '33333333-3333-4333-8333-333333333333';
  const otherTestId = '44444444-4444-4444-8444-444444444444';
  const hiddenParentTestId = '55555555-5555-4555-8555-555555555555';
  const validationTestId = '66666666-6666-4666-8666-666666666666';
  const taxonomyId = '88888888-8888-4888-8888-888888888888';
  const hybridSpec = 'gigachat:Embeddings-2:hybrid-e2e:dim-1024';

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
    projection = app.get(CatalogBenchmarkProjectionService);
    search = app.get(BenchmarkSearchService);
    repository = app.get(BenchmarkSearchRepository);
    embeddings = app.get(EmbeddingService);
    recommendationRequests = app.get(IRecommendationRequestsRepository);
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    offset = 0;
    await clearFixtures();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await clearFixtures();
    await app.close();
  });

  it('indexes and retrieves a published remote Test from projections', async () => {
    await seedPublishedTest();

    await expect(search.indexBenchmark(testId)).resolves.toBe('indexed');

    const document = await prisma.benchmarkSearchDocument.findUniqueOrThrow({
      where: { benchmarkTestId: testId },
    });
    expect(document.documentText).toContain(
      'Benchmark: Remote Search Test / Remote Search Test EN'
    );
    expect(document.documentText).toContain(
      'Suite: Remote Search Suite / Remote Search Suite EN'
    );
    expect(document.sourceUpdatedAt).toEqual(
      new Date('2026-09-12T09:00:00.000Z')
    );

    await expect(search.retrieve('remote search')).resolves.toMatchObject({
      candidates: [
        {
          testId,
          sourceUpdatedAt: '2026-09-12T09:00:00.000Z',
        },
      ],
    });
  });

  it('fuses 1024-dimensional semantic and lexical ranks deterministically', async () => {
    await seedPublishedTest();
    for (const id of [otherTestId, validationTestId, hiddenParentTestId]) {
      await applyTest(testSnapshot(id, suiteId, id === hiddenParentTestId ? 'Unrelated candidate' : 'Tax reporting'));
      await prisma.catalogEntry.create({ data: { testId: id, status: BenchmarkValidationStatus.published } });
    }
    await indexedDocument(testId, 'Unrelated semantic candidate', vector1024(1, 0));
    await indexedDocument(otherTestId, 'Tax reporting', vector1024(0.8, 0.6));
    await indexedDocument(validationTestId, 'Tax reporting', vector1024(0.8, 0.6));
    // A different dimension in this generic vector column must be filtered
    // before evaluating cosine distance, including a mismatched metadata row.
    await indexedDocument(hiddenParentTestId, 'Tax reporting', [1, ...Array<number>(1535).fill(0)]);
    await prisma.$executeRaw`
      UPDATE benchmark_search_documents SET embedding_dimensions = 1024
      WHERE benchmark_test_id = ${hiddenParentTestId}
    `;
    const params = { query: 'tax', embedding: vector1024(1, 0), embeddingSpecId: hybridSpec, limit: 3 };
    const rows = await repository.search(params);
    expect(rows.map(({ testId: id }) => id)).toEqual([otherTestId, validationTestId, testId]);
    expect(rows[0].score).toBeCloseTo((1 / 62 + 1 / 61) * 30.5);
    expect(rows[1].score).toBeCloseTo((1 / 63 + 1 / 62) * 30.5);
    expect(rows[2].score).toBeCloseTo(0.5);
    expect(await repository.search(params)).toEqual(rows);
    expect((await repository.search({ ...params, query: 'taxes' })).map(({ testId: id }) => id))
      .toEqual([otherTestId, validationTestId, testId]);
  });

  it('retains a candidate ranked thirtieth in both branches before taking the final twenty', async () => {
    await applySuite();
    const ids = Array.from({ length: 59 }, (_, index) =>
      `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, '0')}`);
    const sharedCandidateId = ids[58];
    for (const [index, id] of ids.entries()) {
      const lexicalOnly = index < 29;
      const sharedCandidate = id === sharedCandidateId;
      const name = lexicalOnly || sharedCandidate ? 'Tax reporting' : 'Unrelated semantic candidate';
      await applyTest(testSnapshot(id, suiteId, name));
      if (!lexicalOnly) {
        await indexedDocument(id, name, sharedCandidate ? vector1024(0.8, 0.6) : vector1024(1, 0));
      }
    }
    await prisma.catalogEntry.createMany({ data: ids.map((id) => ({
      testId: id, status: BenchmarkValidationStatus.published,
    })) });
    const params = { query: 'tax', embedding: vector1024(1, 0), embeddingSpecId: hybridSpec, limit: 20 };
    const lexicalRanking = await repository.searchText(params.query, 100);
    expect(lexicalRanking).toHaveLength(30);
    expect(lexicalRanking[29].testId).toBe(sharedCandidateId);
    const semanticRanking = await repository.search({ ...params, query: 'notpresentuniqueword', limit: 100 });
    expect(semanticRanking).toHaveLength(30);
    expect(semanticRanking[29].testId).toBe(sharedCandidateId);

    // Truncating each branch to twenty drops this candidate, despite its
    // combined RRF score exceeding every candidate present in just one branch.
    const rows = await repository.search(params);
    expect(rows).toHaveLength(20);
    expect(rows[0].testId).toBe(sharedCandidateId);
    expect(rows[0].score).toBeCloseTo((1 / 90 + 1 / 90) * 30.5);
    for (const row of rows.slice(1)) {
      expect(row.score).toBeLessThanOrEqual(0.5);
      expect(row.score).toBeLessThan(rows[0].score);
    }
  });

  it('excludes wrong specifications, stale versions and false dimensions from semantic ranking', async () => {
    await seedPublishedTest();
    await indexedDocument(testId, 'Tax reporting', vector1024(1, 0));
    const params = { query: 'tax', embedding: vector1024(1, 0), embeddingSpecId: hybridSpec, limit: 20 };
    expect(await repository.search(params)).toHaveLength(1);
    await prisma.benchmarkSearchDocument.update({ where: { benchmarkTestId: testId },
      data: { embeddingSpecId: 'previous-embedding-model' } });
    expect(await repository.search(params)).toEqual([]);
    await prisma.benchmarkSearchDocument.update({ where: { benchmarkTestId: testId },
      data: { embeddingSpecId: hybridSpec, sourceUpdatedAt: new Date('2020-01-01') } });
    expect(await repository.search(params)).toEqual([]);
    await prisma.benchmarkSearchDocument.update({ where: { benchmarkTestId: testId },
      data: { sourceUpdatedAt: new Date('2026-09-12T09:00:00.000Z') } });
    expect(await repository.search(params)).toHaveLength(1);
    await prisma.benchmarkSearchDocument.update({ where: { benchmarkTestId: testId },
      data: { embeddingDimensions: 1536 } });
    expect(await repository.search(params)).toEqual([]);
  });

  it('includes relevant fresh text beside unrelated vectors throughout partial reindexing', async () => {
    await seedPublishedTest();
    await indexedDocument(testId, 'Unrelated cached content', vector1024(1, 0));
    await applyTest(testSnapshot(otherTestId, suiteId, 'Tax reporting'));
    await prisma.catalogEntry.create({ data: { testId: otherTestId, status: BenchmarkValidationStatus.published } });
    const params = { query: 'tax', embedding: vector1024(1, 0), embeddingSpecId: hybridSpec, limit: 2 };
    const check = async () => {
      const rows = await repository.search(params);
      expect(rows.map(({ testId: id }) => id)).toEqual([otherTestId, testId]);
      expect(rows[0]).toMatchObject({ vectorScore: 0, score: 0.5 });
      expect(rows[0].document).toContain('Tax reporting');
      expect((await repository.search({ ...params, limit: 1 })).map(({ testId: id }) => id))
        .toEqual([otherTestId]);
    };
    await check(); // No embedding yet.
    await indexedDocument(otherTestId, 'Obsolete document text', vector1024(1, 0));
    await prisma.benchmarkSearchDocument.update({ where: { benchmarkTestId: otherTestId },
      data: { embeddingSpecId: 'previous-embedding-model' } });
    await check();
    await prisma.benchmarkSearchDocument.update({ where: { benchmarkTestId: otherTestId },
      data: { embeddingSpecId: hybridSpec, sourceUpdatedAt: new Date('2020-01-01') } });
    await check();
    await prisma.benchmarkSearchDocument.update({ where: { benchmarkTestId: otherTestId },
      data: { sourceUpdatedAt: new Date('2026-09-12T09:00:00.000Z'), embeddingDimensions: 1536 } });
    await check();
  });

  it('searches fresh suite and taxonomy labels when their embedding refresh fails', async () => {
    await prisma.dictMacroGroup.create({ data: { id: taxonomyId,
      name: 'oldtaxonomyuniqueword', nameEn: 'oldtaxonomyuniqueword' } });
    await applySuite(suiteId, 'oldsuiteuniqueword');
    const snapshot = testSnapshot();
    await applyTest({ ...snapshot, specification: { ...snapshot.specification, macroGroupId: taxonomyId } });
    await prisma.catalogEntry.create({ data: { testId, status: BenchmarkValidationStatus.published } });
    await search.indexBenchmark(testId);
    const before = await prisma.benchmarkSearchDocument.findUniqueOrThrow({ where: { benchmarkTestId: testId } });
    expect(before.documentText).toContain('oldsuiteuniqueword');
    expect(before.documentText).toContain('oldtaxonomyuniqueword');
    await prisma.catalogBenchmarkProjection.update({ where: { benchmarkId: suiteId }, data: {
      name: 'newsuiteuniqueword', nameEn: 'newsuiteuniqueword', sourceUpdatedAt: new Date('2026-09-13') } });
    await prisma.dictMacroGroup.update({ where: { id: taxonomyId }, data: {
      name: 'newtaxonomyuniqueword', nameEn: 'newtaxonomyuniqueword' } });
    jest.spyOn(embeddings, 'embedDocument').mockRejectedValue(new Error('embedding refresh failed'));
    await expect(search.indexBenchmark(testId)).rejects.toThrow('embedding refresh failed');
    expect(await prisma.benchmarkSearchDocument.findUniqueOrThrow({ where: { benchmarkTestId: testId } }))
      .toEqual(before);
    jest.spyOn(embeddings, 'embedQuery').mockRejectedValue(new Error('embedding provider unavailable'));
    for (const query of ['newsuiteuniqueword', 'newtaxonomyuniqueword']) {
      const result = await search.retrieve(query);
      expect(result.candidates.map((candidate) => candidate.testId)).toEqual([testId]);
      expect(result.candidates[0].document).toContain('newsuiteuniqueword');
      expect(result.candidates[0].document).toContain('newtaxonomyuniqueword');
      expect(result.candidates[0].document).not.toContain('oldsuiteuniqueword');
      expect(result.candidates[0].document).not.toContain('oldtaxonomyuniqueword');
      const hybrid = await repository.search({ query, embedding: vector1024(1, 0),
        embeddingSpecId: hybridSpec, limit: 20 });
      expect(hybrid.map(({ testId: id }) => id)).toEqual([testId]);
      expect(hybrid[0].document).toBe(result.candidates[0].document);
    }
    for (const query of ['oldsuiteuniqueword', 'oldtaxonomyuniqueword']) {
      expect((await search.retrieve(query)).candidates).toEqual([]);
      expect(await repository.search({ query, embedding: vector1024(1, 0),
        embeddingSpecId: hybridSpec, limit: 20 })).toEqual([]);
    }
  });

  it('searches current descriptions, skills, taxonomy and subsamples without embeddings', async () => {
    await prisma.dictMacroGroup.create({ data: { id: taxonomyId,
      name: 'Юриспруденция', nameEn: 'Jurisprudence' } });
    await applySuite();
    const snapshot = testSnapshot();
    await applyTest({ ...snapshot, specification: { ...snapshot.specification,
      description: 'Налоги и налоговые декларации',
      macroGroupId: taxonomyId, skills: ['oncology'],
      datasetSubsamples: [{ id: '99999999-9999-4999-8999-999999999999',
        name: 'Diagnostic radiology', nameEn: 'Diagnostic radiology',
        description: 'Medical scans', examples: [], sizeInSamples: 1, medianSampleSizeWords: 1,
        requestLengthDist: { min: 1, median: 1, max: 1 }, responseLengthDist: { min: 1, median: 1, max: 1 } }],
    } });
    await prisma.catalogEntry.create({ data: { testId, status: BenchmarkValidationStatus.published } });
    jest.spyOn(embeddings, 'embedQuery').mockRejectedValue(new Error('embedding provider unavailable'));
    for (const query of ['налог', 'oncology', 'Jurisprudence', 'radiology']) {
      await expect(search.retrieve(query)).resolves.toMatchObject({
        retrievalVersion: 'postgres-fts-ru-en-v1', fallbackReason: 'embedding_failed',
        candidates: [{ testId, sourceUpdatedAt: snapshot.updatedAt }],
      });
    }
    expect((await search.searchForInterviewerAgent('налог', 1)).candidates[0].benchmark_id).toBe(testId);
    expect((await search.retrieve('notpresentuniqueword')).candidates).toEqual([]);
    expect((await search.retrieve('% _')).candidates).toEqual([]);
    await expect(prisma.benchmarkSearchDocument.count()).resolves.toBe(0);
    // Never reuse old source text just because a vector document exists.
    await indexedDocument(testId, 'staleonlyuniqueword', vector1024(1, 0), new Date('2020-01-01'));
    expect((await search.retrieve('staleonlyuniqueword')).candidates).toEqual([]);
    expect((await search.retrieve('налог')).candidates.map((candidate) => candidate.testId)).toEqual([testId]);
  });

  it('applies publication, archival and complete-projection visibility to hybrid and fallback equally', async () => {
    const changes: Array<() => Promise<unknown>> = [
      () => prisma.catalogEntry.update({ where: { testId }, data: { status: BenchmarkValidationStatus.validation } }),
      () => prisma.catalogEntry.update({ where: { testId }, data: { status: BenchmarkValidationStatus.rejected } }),
      () => prisma.catalogEntry.update({ where: { testId }, data: { archivedAt: new Date() } }),
      () => prisma.catalogEntry.delete({ where: { testId } }),
      () => prisma.catalogTestProjection.update({ where: { testId }, data: { deletedAt: new Date() } }),
      () => prisma.catalogTestProjection.update({ where: { testId }, data: { snapshot: Prisma.DbNull } }),
      () => prisma.catalogTestProjection.update({ where: { testId }, data: { name: null } }),
      () => prisma.catalogTestProjection.update({ where: { testId }, data: { nameEn: null } }),
      () => prisma.catalogTestProjection.update({ where: { testId }, data: { sourceCreatedAt: null } }),
      () => prisma.catalogBenchmarkProjection.update({ where: { benchmarkId: suiteId }, data: { deletedAt: new Date() } }),
      () => prisma.catalogBenchmarkProjection.update({ where: { benchmarkId: suiteId }, data: { name: null } }),
      () => prisma.catalogBenchmarkProjection.update({ where: { benchmarkId: suiteId }, data: { nameEn: null } }),
      () => prisma.catalogBenchmarkProjection.update({ where: { benchmarkId: suiteId }, data: { sourceCreatedAt: null } }),
    ];
    for (const change of changes) {
      await seedPublishedTest();
      await indexedDocument(testId, 'Remote search', vector1024(1, 0));
      await change();
      expect(await repository.search({ query: 'remote', embedding: vector1024(1, 0),
        embeddingSpecId: hybridSpec, limit: 20 })).toEqual([]);
      expect(await repository.searchText('remote', 20)).toEqual([]);
      await clearFixtures();
    }
  });

  it('serves legacy Factory candidates and dataset IDs from published projections', async () => {
    await applySuite();
    const snapshot = testSnapshot();
    const datasetId = '77777777-7777-4777-8777-777777777777';
    await applyTest({
      ...snapshot,
      specification: {
        ...snapshot.specification,
        datasetSubsamples: [{
          id: datasetId,
          name: 'First dataset',
          nameEn: 'First dataset',
          description: 'Remote dataset description',
          sizeInSamples: 1,
          medianSampleSizeWords: 2,
          requestLengthDist: { min: 1, median: 2, max: 3 },
          responseLengthDist: { min: 1, median: 2, max: 3 },
          examples: [],
        }],
      },
    });
    await prisma.catalogEntry.create({
      data: { testId, status: BenchmarkValidationStatus.published },
    });
    await applyTest(testSnapshot(otherTestId, suiteId, 'Other Remote Test'));
    await prisma.catalogEntry.create({
      data: { testId: otherTestId, status: BenchmarkValidationStatus.published },
    });

    const result = await search.searchForLegacyInterviewer('remote', 2);
    expect(result).toMatchObject({
      retrieval_version: 'postgres-substring-v1',
      candidates: [
        { benchmark_id: testId, dataset_id: datasetId, score: 1,
          dataset_description: 'First dataset Remote dataset description' },
        { benchmark_id: otherTestId, dataset_id: `benchmark-test:${otherTestId}`,
          score: 1, dataset_description: '' },
      ],
    });
    expect(result.candidates[0].benchmark_description).toContain('Remote Search Suite');
    expect((await search.searchForLegacyInterviewer('remote', 1)).candidates).toHaveLength(1);
    expect((await search.searchForLegacyInterviewer('% _', 10)).candidates).toEqual([]);
    await expect(prisma.benchmarkSearchDocument.count()).resolves.toBe(0);
  });

  it('excludes private, archived and incomplete projection records from legacy search', async () => {
    await seedPublishedTest();
    const mutations: Array<() => Promise<unknown>> = [
      () => prisma.catalogEntry.update({ where: { testId }, data: {
        status: BenchmarkValidationStatus.validation,
      } }),
      () => prisma.catalogEntry.update({ where: { testId }, data: {
        status: BenchmarkValidationStatus.rejected,
      } }),
      () => prisma.catalogEntry.update({ where: { testId }, data: { archivedAt: new Date() } }),
      () => prisma.catalogEntry.delete({ where: { testId } }),
      () => prisma.catalogTestProjection.update({ where: { testId }, data: { deletedAt: new Date() } }),
      () => prisma.catalogTestProjection.update({ where: { testId }, data: { snapshot: Prisma.DbNull } }),
      () => prisma.catalogTestProjection.update({ where: { testId }, data: { name: null } }),
      () => prisma.catalogTestProjection.update({ where: { testId }, data: { nameEn: null } }),
      () => prisma.catalogTestProjection.update({ where: { testId }, data: { sourceCreatedAt: null } }),
      () => prisma.catalogBenchmarkProjection.update({ where: { benchmarkId: suiteId }, data: {
        deletedAt: new Date(),
      } }),
      () => prisma.catalogBenchmarkProjection.update({ where: { benchmarkId: suiteId }, data: { name: null } }),
      () => prisma.catalogBenchmarkProjection.update({ where: { benchmarkId: suiteId }, data: { nameEn: null } }),
      () => prisma.catalogBenchmarkProjection.update({ where: { benchmarkId: suiteId }, data: {
        sourceCreatedAt: null,
      } }),
    ];
    for (const mutate of mutations) {
      await mutate();
      await expect(search.searchForLegacyInterviewer('remote', 10)).resolves.toMatchObject({ candidates: [] });
      await clearFixtures();
      await seedPublishedTest();
    }
  });

  it('removes documents when Catalog publication or archival changes', async () => {
    await seedPublishedTest();
    await search.indexBenchmark(testId);

    await prisma.catalogEntry.update({
      where: { testId },
      data: { archivedAt: new Date('2026-09-12T10:00:00.000Z') },
    });
    await expect(search.indexBenchmark(testId)).resolves.toBe('removed');

    await prisma.catalogEntry.update({
      where: { testId },
      data: {
        archivedAt: null,
        status: BenchmarkValidationStatus.rejected,
      },
    });
    await expect(search.indexBenchmark(testId)).resolves.toBe('removed');
    await expect(prisma.benchmarkSearchDocument.count()).resolves.toBe(0);
  });

  it('uses fresh projection text until a stale embedding is synchronized', async () => {
    await seedPublishedTest();
    await search.indexBenchmark(testId);

    await prisma.catalogTestProjection.update({
      where: { testId },
      data: { sourceUpdatedAt: new Date('2026-09-12T11:00:00.000Z') },
    });

    await expect(search.retrieve('remote search')).resolves.toMatchObject({
      retrievalVersion: expect.stringContaining('pgvector-fts-ru-en-rrf60-v1'),
      candidates: [{ testId, sourceUpdatedAt: '2026-09-12T11:00:00.000Z' }],
    });
    await expect(search.indexBenchmark(testId)).resolves.toBe('synchronized');
    await expect(search.retrieve('remote search')).resolves.toMatchObject({
      candidates: [{ testId }],
    });
  });

  it('keeps the cache row independent when source projections disappear', async () => {
    await seedPublishedTest();
    await search.indexBenchmark(testId);

    await prisma.catalogTestProjection.deleteMany({ where: { testId } });
    await prisma.catalogBenchmarkProjection.deleteMany({
      where: { benchmarkId: suiteId },
    });

    await expect(
      prisma.benchmarkSearchDocument.count({
        where: { benchmarkTestId: testId },
      })
    ).resolves.toBe(1);
    await expect(search.retrieve('remote search')).resolves.toMatchObject({
      candidates: [],
    });
  });

  it('reindexes and removes a complete remote suite through projections', async () => {
    await seedPublishedTest();
    await applySuite(otherSuiteId, 'Other Remote Suite');
    await applyTest(
      testSnapshot(otherTestId, otherSuiteId, 'Other Remote Test')
    );
    await prisma.catalogEntry.create({
      data: {
        testId: otherTestId,
        status: BenchmarkValidationStatus.published,
      },
    });

    await expect(search.reindexAll()).resolves.toEqual({
      indexed: 2,
      failed: 0,
    });
    await expect(prisma.benchmarkSearchDocument.count()).resolves.toBe(2);

    await prisma.catalogBenchmarkProjection.update({
      where: { benchmarkId: suiteId },
      data: { deletedAt: new Date('2026-09-12T12:00:00.000Z') },
    });

    await expect(search.reindexSuite(suiteId)).resolves.toBe(0);
    await expect(
      prisma.benchmarkSearchDocument.findMany({
        select: { benchmarkTestId: true },
      })
    ).resolves.toEqual([{ benchmarkTestId: otherTestId }]);
  });

  it('revalidates recommendation results against projected lifecycle and source version', async () => {
    await seedPublishedTest();
    await applyTest(testSnapshot(otherTestId, suiteId, 'Stale Remote Test'));
    await applyTest(
      testSnapshot(validationTestId, suiteId, 'Validation Remote Test')
    );
    await applySuite(otherSuiteId, 'Deleted Remote Suite');
    await applyTest(
      testSnapshot(hiddenParentTestId, otherSuiteId, 'Hidden Parent Test')
    );
    await prisma.catalogBenchmarkProjection.update({
      where: { benchmarkId: otherSuiteId },
      data: { deletedAt: new Date('2026-09-12T10:00:00.000Z') },
    });
    await prisma.catalogEntry.createMany({
      data: [
        {
          testId: otherTestId,
          status: BenchmarkValidationStatus.published,
        },
        {
          testId: validationTestId,
          status: BenchmarkValidationStatus.validation,
        },
        {
          testId: hiddenParentTestId,
          status: BenchmarkValidationStatus.published,
        },
      ],
    });

    const owner = await prisma.user.create({
      data: {
        username: 'projection-recommendation-owner',
        email: 'projection-recommendation-owner@example.test',
        password: 'not-used',
      },
    });
    const conversation = await prisma.conversation.create({
      data: { userId: owner.id },
    });
    const pending = await recommendationRequests.createPending({
      id: '77777777-7777-4777-8777-777777777777',
      conversationId: conversation.id,
      query: 'remote candidate',
      topK: 4,
    });
    const candidates = [
      {
        testId,
        document: 'active',
        score: 0.9,
        sourceUpdatedAt: '2026-09-12T09:00:00.000Z',
      },
      {
        testId: otherTestId,
        document: 'stale',
        score: 0.8,
        sourceUpdatedAt: '2026-09-12T08:59:59.000Z',
      },
      {
        testId: validationTestId,
        document: 'not published',
        score: 0.7,
        sourceUpdatedAt: '2026-09-12T09:00:00.000Z',
      },
      {
        testId: hiddenParentTestId,
        document: 'deleted parent',
        score: 0.6,
        sourceUpdatedAt: '2026-09-12T09:00:00.000Z',
      },
    ];

    const completed = await recommendationRequests.complete({
      id: pending.id,
      retrievalVersion: 'projection-boundary',
      retrievalDurationMs: 1,
      candidatePayload: candidates,
      rerankerVersion: 'projection-boundary',
      resultPayload: candidates.map((candidate, index) => ({
        testId: candidate.testId,
        rank: index + 1,
        score: candidate.score,
        rerankScore: candidate.score,
        sourceUpdatedAt: candidate.sourceUpdatedAt,
      })),
    });

    expect(completed.request.resultPayload).toEqual([
      expect.objectContaining({ testId }),
    ]);
    expect(completed.recommendations).toEqual([
      expect.objectContaining({
        conversationId: conversation.id,
        testId,
      }),
    ]);
  });

  async function seedPublishedTest(): Promise<void> {
    await applySuite();
    await applyTest(testSnapshot());
    await prisma.catalogEntry.create({
      data: {
        testId,
        status: BenchmarkValidationStatus.published,
      },
    });
  }

  function vector1024(first: number, second: number): number[] {
    return [first, second, ...Array<number>(1022).fill(0)];
  }

  async function indexedDocument(
    id: string, documentText: string, embedding: number[],
    sourceUpdatedAt = new Date('2026-09-12T09:00:00.000Z')
  ): Promise<void> {
    await repository.upsertDocument({ benchmarkTestId: id, documentText,
      embedding, sourceUpdatedAt, embeddingSpecId: hybridSpec, contentHash: 'hybrid-test' });
  }

  async function applyTest(value: BenchmarkTestSnapshotV1): Promise<void> {
    await projection.apply(
      {
        eventId: randomUUID(),
        eventType: BENCHMARK_MESSAGE_TYPES.testSnapshot,
        eventVersion: 1,
        occurredAt: '2026-09-12T09:00:00.000Z',
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

  async function applySuite(
    id = suiteId,
    name = 'Remote Search Suite'
  ): Promise<void> {
    await projection.apply(
      {
        eventId: randomUUID(),
        eventType: BENCHMARK_MESSAGE_TYPES.suiteSnapshot,
        eventVersion: 1,
        occurredAt: '2026-09-12T09:00:00.000Z',
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
            description: 'Remote suite description',
            createdAt: '2026-09-12T08:00:00.000Z',
            updatedAt: '2026-09-12T09:00:00.000Z',
            deletedAt: null,
          },
        },
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
    await prisma.recommendation.deleteMany();
    await prisma.recommendationRequest.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.user.deleteMany();
    await prisma.benchmarkSearchDocument.deleteMany();
    await prisma.inboxMessage.deleteMany({
      where: { topic: KAFKA_TOPICS.benchmarkEvents },
    });
    await prisma.catalogEntry.deleteMany();
    await prisma.catalogTestProjection.deleteMany();
    await prisma.catalogBenchmarkProjection.deleteMany();
    await prisma.dictMacroGroup.deleteMany({ where: { id: taxonomyId } });
  }

  function testSnapshot(
    id = testId,
    benchmarkId = suiteId,
    name = 'Remote Search Test'
  ): BenchmarkTestSnapshotV1 {
    return {
      id,
      aggregateVersion: 1,
      specification: {
        suiteId: benchmarkId,
        name,
        nameEn: `${name} EN`,
        description: 'Remote semantic search content',
        subGroupIds: [],
        abilityTaxonIds: [],
        modalityIds: [],
        capabilityIds: [],
        domainIds: [],
        subdomainIds: [],
        abilityTags: ['remote'],
        skills: ['semantic search'],
        metricIds: [],
        examples: [{ input: 'remote prompt', output: 'remote answer' }],
        datasetSubsamples: [],
        references: [],
        links: [],
        sizeInSamples: 100,
        medianSampleSizeWords: 10,
        requestLengthDist: { min: 1, median: 2, max: 3 },
        responseLengthDist: { min: 1, median: 2, max: 3 },
        isDifficultyAutoCalculated: false,
        isGenerated: false,
      },
      specificationLockedAt: null,
      specificationLockReason: null,
      createdAt: '2026-09-12T08:00:00.000Z',
      updatedAt: '2026-09-12T09:00:00.000Z',
      deletedAt: null,
    };
  }
});
