import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { BenchmarkValidationStatus } from '@/generated/prisma/enums';
import { BenchmarkSearchDocumentBuilder } from '../benchmark-search-document.builder';
import { BenchmarkSearchRepository } from '../benchmark-search.repository';
import { BenchmarkSearchService } from '../benchmark-search.service';
import { EmbeddingService } from '../embedding.service';
import type { BenchmarkSearchSource } from '../types';

describe('BenchmarkSearchService', () => {
  const sourceUpdatedAt = new Date('2026-09-24T19:16:09.206Z');
  const document = 'searchable benchmark document';
  const contentHash = createHash('sha256').update(document).digest('hex');
  const source = {
    id: 'test-id',
    deletedAt: null,
    updatedAt: sourceUpdatedAt,
    benchmark: { deletedAt: null },
    catalogEntry: {
      status: BenchmarkValidationStatus.published,
      archivedAt: null,
    },
  } as unknown as BenchmarkSearchSource;

  const findSource = jest.fn();
  const findDocumentState = jest.fn();
  const touchDocumentSourceUpdatedAt = jest.fn();
  const upsertDocument = jest.fn();
  const deleteDocument = jest.fn();
  const embedDocument = jest.fn();
  const embedQuery = jest.fn();
  const search = jest.fn();
  const searchText = jest.fn();
  const build = jest.fn();

  const service = new BenchmarkSearchService(
    {
      findSource,
      findDocumentState,
      touchDocumentSourceUpdatedAt,
      upsertDocument,
      deleteDocument,
      search,
      searchText,
    } as unknown as BenchmarkSearchRepository,
    { build } as unknown as BenchmarkSearchDocumentBuilder,
    {
      specId: 'embedding-spec',
      embedDocument,
      embedQuery,
    } as unknown as EmbeddingService,
    {
      getOrThrow: jest.fn().mockReturnValue({
        retrievalCandidateLimit: 20,
      }),
    } as unknown as ConfigService
  );

  beforeEach(() => {
    jest.resetAllMocks();
    findSource.mockResolvedValue(source);
    build.mockReturnValue(document);
  });

  it('only advances source timestamp when searchable content is unchanged', async () => {
    findDocumentState.mockResolvedValue({
      contentHash,
      embeddingSpecId: 'embedding-spec',
      sourceUpdatedAt: new Date('2026-09-24T11:21:43.861Z'),
    });

    await expect(service.indexBenchmark(source.id)).resolves.toBe('synchronized');

    expect(touchDocumentSourceUpdatedAt).toHaveBeenCalledWith(source.id, sourceUpdatedAt);
    expect(embedDocument).not.toHaveBeenCalled();
    expect(upsertDocument).not.toHaveBeenCalled();
  });

  it('regenerates the embedding when searchable content changed', async () => {
    findDocumentState.mockResolvedValue({
      contentHash: 'old-content-hash',
      embeddingSpecId: 'embedding-spec',
      sourceUpdatedAt,
    });
    embedDocument.mockResolvedValue({ values: [0.1, 0.2], dimensions: 2 });

    await expect(service.indexBenchmark(source.id)).resolves.toBe('indexed');

    expect(embedDocument).toHaveBeenCalledWith(document);
    expect(upsertDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        benchmarkTestId: source.id,
        contentHash,
        sourceUpdatedAt,
      })
    );
  });

  it('returns PostgreSQL fused relevance and preserves canonical Test versions', async () => {
    embedQuery.mockResolvedValue({ values: [1, 0], dimensions: 2 });
    search.mockResolvedValue([{ testId: source.id, document, score: 0.99, vectorScore: 0.4, sourceUpdatedAt }]);
    await expect(service.retrieve('  benchmark query  ', 'request')).resolves.toMatchObject({
      retrievalVersion: 'embedding-spec:dim-2:pgvector-fts-ru-en-rrf60-v1',
      candidates: [{ testId: source.id, document, score: 0.99, sourceUpdatedAt: sourceUpdatedAt.toISOString() }],
    });
    expect(embedQuery).toHaveBeenCalledWith('benchmark query', expect.any(AbortSignal));
    expect(search).toHaveBeenCalledWith({ query: 'benchmark query', embedding: [1, 0],
      embeddingSpecId: 'embedding-spec', limit: 20 });
    expect(searchText).not.toHaveBeenCalled();
  });

  it.each(['embedding_failed', 'hybrid_search_failed', 'hybrid_search_empty'] as const)(
    'uses text retrieval after %s', async (reason) => {
      embedQuery.mockResolvedValue({ values: [1, 0], dimensions: 2 });
      if ('embedding_failed' === reason) embedQuery.mockRejectedValue(new Error('provider unavailable'));
      if ('hybrid_search_failed' === reason) search.mockRejectedValue(new Error('index unavailable'));
      if ('hybrid_search_empty' === reason) search.mockResolvedValue([]);
      searchText.mockResolvedValue([{ testId: source.id, document, score: 0.6, vectorScore: 0, sourceUpdatedAt }]);
      await expect(service.retrieve('lexical query')).resolves.toMatchObject({
        retrievalVersion: 'postgres-fts-ru-en-v1', fallbackReason: reason,
        candidates: [{ testId: source.id, score: 0.6, sourceUpdatedAt: sourceUpdatedAt.toISOString() }],
      });
      expect(searchText).toHaveBeenCalledWith('lexical query', 20);
      if ('embedding_failed' === reason) expect(search).not.toHaveBeenCalled();
    }
  );

  it('does not disguise a database failure as an empty result', async () => {
    embedQuery.mockRejectedValue(new Error('provider unavailable'));
    searchText.mockRejectedValue(new Error('database unavailable'));
    await expect(service.retrieve('lexical query')).rejects.toThrow('database unavailable');
  });

  it('rejects blank queries before calling either search path', async () => {
    await expect(service.retrieve('  ')).rejects.toThrow('Retrieval query must not be empty');
    expect(embedQuery).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(searchText).not.toHaveBeenCalled();
  });
});
