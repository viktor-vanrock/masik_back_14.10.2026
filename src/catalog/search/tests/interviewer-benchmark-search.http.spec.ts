import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '@/auth/jwt/jwt-auth.guard';
import { JwtStrategy } from '@/auth/jwt/jwt.strategy';
import { OriginCsrfGuard } from '@/common/guards/origin-csrf.guard';
import { InterviewerServiceTokenGuard } from '@/generation/interviewer-service-token.guard';
import { BenchmarkSearchDocumentBuilder } from '../benchmark-search-document.builder';
import { BenchmarkSearchRepository } from '../benchmark-search.repository';
import { BenchmarkSearchService } from '../benchmark-search.service';
import { EmbeddingService } from '../embedding.service';
import { InterviewerBenchmarkSearchController } from '../interviewer-benchmark-search.controller';

describe('Factory legacy full-text search contract', () => {
  let app: NestExpressApplication;
  const searchNaive = jest.fn();
  const search = jest.fn();
  const searchText = jest.fn();
  const embedQuery = jest.fn();
  const row = (testId: string) => ({
    testId, document: `Test ${testId}`, score: 0.5,
    datasetId: null, datasetDescription: '',
  });

  beforeAll(async () => {
    const values: Record<string, unknown> = {
      'agent.apiKey': 'factory-token', jwtAccessSecret: 'cookie-secret',
      nodeEnv: 'dev', trustedOrigins: [],
      embedding: { retrievalCandidateLimit: 20 },
    };
    const config = {
      get: (key: string) => values[key],
      getOrThrow: (key: string) => values[key],
    };
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [InterviewerBenchmarkSearchController],
      providers: [
        JwtStrategy, InterviewerServiceTokenGuard, BenchmarkSearchService,
        { provide: ConfigService, useValue: config },
        { provide: BenchmarkSearchRepository, useValue: { searchNaive, search, searchText } },
        { provide: BenchmarkSearchDocumentBuilder, useValue: {} },
        { provide: EmbeddingService, useValue: { embedQuery, specId: 'embedding-spec' } },
        { provide: APP_GUARD, useClass: OriginCsrfGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => { await app?.close(); });
  beforeEach(() => {
    jest.clearAllMocks();
    searchNaive.mockResolvedValue([
      { ...row('test-a'), datasetId: 'subset-a', datasetDescription: 'Dataset A' },
      row('test-b'),
    ]);
  });

  const path = '/api/internal/v1/interviewer/benchmark-tests/search';

  it('requires the service token and returns the strict Factory candidate shape', async () => {
    await request(app.getHttpServer()).post(path)
      .send({ query: 'language', top_k: 2 }).expect(401);
    await request(app.getHttpServer()).post(path)
      .set('Authorization', 'Bearer wrong')
      .send({ query: 'language', top_k: 2 }).expect(401);

    await request(app.getHttpServer()).post(path)
      .set('Authorization', 'Bearer factory-token')
      .send({ query: ' language ', top_k: 2 }).expect(201, {
        retrieval_version: 'postgres-substring-v1',
        candidates: [
          { benchmark_id: 'test-a', dataset_id: 'subset-a', score: 0.5,
            benchmark_description: 'Test test-a', dataset_description: 'Dataset A' },
          { benchmark_id: 'test-b', dataset_id: 'benchmark-test:test-b', score: 0.5,
            benchmark_description: 'Test test-b', dataset_description: '' },
        ],
      });
    expect(searchNaive).toHaveBeenCalledTimes(1);
    expect(searchNaive).toHaveBeenCalledWith('language', 2);
  });

  it('rejects blank queries and oversized result requests', async () => {
    for (const endpoint of [path, `${path}-agent`]) {
      await request(app.getHttpServer()).post(endpoint)
        .set('Authorization', 'Bearer factory-token')
        .send({ query: '   ', top_k: 2 }).expect(400);
    }
    expect(embedQuery).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(searchText).not.toHaveBeenCalled();
    await request(app.getHttpServer()).post(path)
      .set('Authorization', 'Bearer factory-token')
      .send({ query: 'language', top_k: 101 }).expect(400);
    expect(searchNaive).not.toHaveBeenCalled();
  });

  it('limits legacy descriptions without changing the remote Test identity', async () => {
    searchNaive.mockResolvedValue([
      { ...row('remote-test'), document: ` ${'a'.repeat(4100)} `,
        datasetId: 'remote-subsample', datasetDescription: ` ${'b'.repeat(2100)} ` },
    ]);
    const response = await request(app.getHttpServer()).post(path)
      .set('Authorization', 'Bearer factory-token')
      .send({ query: 'remote', top_k: 1 }).expect(201);
    expect(response.body.candidates).toEqual([
      { benchmark_id: 'remote-test', dataset_id: 'remote-subsample', score: 0.5,
        benchmark_description: 'a'.repeat(4000), dataset_description: 'b'.repeat(2000) },
    ]);
  });

  it('guards native agent search and uses hybrid retrieval with real Test IDs', async () => {
    const nativePath = `${path}-agent`;
    await request(app.getHttpServer()).post(nativePath)
      .send({ query: 'medicine', top_k: 2 }).expect(401);
    expect(embedQuery).not.toHaveBeenCalled();
    embedQuery.mockResolvedValue({ values: [1, 0], dimensions: 2 });
    search.mockResolvedValue([{ testId: 'remote-test', document: 'Medical Test',
      vectorScore: 0.8, score: 0.9, sourceUpdatedAt: new Date('2026-10-01T00:00:00.000Z') }]);
    const response = await request(app.getHttpServer()).post(nativePath)
      .set('Authorization', 'Bearer factory-token')
      .send({ query: ' medicine ', top_k: 2 }).expect(201);
    expect(embedQuery).toHaveBeenCalledWith('medicine', expect.any(AbortSignal));
    expect(search).toHaveBeenCalledWith({ query: 'medicine', embedding: [1, 0], embeddingSpecId: 'embedding-spec', limit: 20 });
    expect(searchNaive).not.toHaveBeenCalled();
    expect(response.body).toEqual({ retrieval_version: 'embedding-spec:dim-2:pgvector-fts-ru-en-rrf60-v1',
      candidates: [{ benchmark_id: 'remote-test', benchmark_description: 'Medical Test',
        score: 0.9, source_updated_at: '2026-10-01T00:00:00.000Z' }] });
  });

  it('keeps native agent search available through lexical fallback during an embedding outage', async () => {
    embedQuery.mockRejectedValue(new Error('embedding timeout'));
    searchText.mockResolvedValue([{ testId: 'remote-test', document: 'Tax reporting',
      score: 0.6, vectorScore: 0, sourceUpdatedAt: new Date('2026-10-06T00:00:00.000Z') }]);
    await request(app.getHttpServer()).post(`${path}-agent`)
      .set('Authorization', 'Bearer factory-token')
      .send({ query: 'tax', top_k: 1 }).expect(201, {
        retrieval_version: 'postgres-fts-ru-en-v1',
        candidates: [{ benchmark_id: 'remote-test', benchmark_description: 'Tax reporting',
          score: 0.6, source_updated_at: '2026-10-06T00:00:00.000Z' }],
      });
    expect(searchNaive).not.toHaveBeenCalled();
  });
});
