import { BadRequestException } from '@nestjs/common';
import { BenchmarkSearchService } from '@/catalog/search/benchmark-search.service';
import {
  RecommendationRequest,
  RecommendationRequestStatus,
} from '@/generated/prisma/client';
import { FactorySelectionService } from '../factory-selection.service';
import { RecommendationRequestsService } from '../recommendation-requests.service';
import { IRecommendationRequestsRepository } from '../repository/recommendation-requests.repository.interface';
import type { ConfigService } from '@nestjs/config';

describe('RecommendationRequestsService', () => {
  const createPending = jest.fn();
  const complete = jest.fn();
  const fail = jest.fn();
  const retrieve = jest.fn();
  const repository = {
    createPending,
    complete,
    fail,
  } as unknown as IRecommendationRequestsRepository;
  const search = { retrieve } as unknown as BenchmarkSearchService;
  let service: RecommendationRequestsService;
  const request = recommendationRequest();
  const candidates = [
    {
      testId: 'vector-first',
      document: 'Benchmark: code generation',
      score: 0.93,
      sourceUpdatedAt: '2026-08-25T12:00:00.000Z',
    },
    {
      testId: 'reranker-first',
      document: 'Benchmark: medical questions',
      score: 0.72,
      sourceUpdatedAt: '2026-08-25T12:00:00.000Z',
    },
  ] as const;

  beforeEach(() => {
    jest.clearAllMocks();
    service = recommendationService(repository, search);
    createPending.mockResolvedValue(request);
    retrieve.mockResolvedValue({
      candidates,
      retrievalVersion: 'gigachat:dim-1024:pgvector-fts-ru-en-rrf60-v1',
      durationMs: 12,
    });
    complete.mockResolvedValue({
      request: { ...request, status: RecommendationRequestStatus.completed },
      recommendations: [
        {
          id: 'recommendation-id',
          conversationId: request.conversationId,
          testId: 'reranker-first',
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
  });

  it('keeps test identity and publication filtering when Factory selects and explains results', async () => {
    const select = jest.fn().mockResolvedValue([
      { testId: 'reranker-first', explanation: 'Medical match.' },
      { testId: 'vector-first', explanation: 'Code match.' },
    ]);
    service = new RecommendationRequestsService(repository, search, {
      getOrThrow: () => ({ maxConcurrentExecutions: 1, selectionProvider: 'factory' }),
    } as unknown as ConfigService, { select } as unknown as FactorySelectionService);
    const notification = await service.execute({ ...request, topK: 2 });
    expect(select).toHaveBeenCalledWith(request.id, request.query, candidates, 2);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      candidatePayload: candidates,
      resultPayload: [
        expect.objectContaining({ testId: 'reranker-first', explanation: 'Medical match.', rank: 1 }),
        expect.objectContaining({ testId: 'vector-first', explanation: 'Code match.', rank: 2 }),
      ],
    }));
    // The repository may remove a candidate unpublished while Factory was responding.
    expect(notification).toEqual(expect.objectContaining({ explanations: [
      { testId: 'reranker-first', explanation: 'Medical match.' },
    ] }));
  });

  it('honors an empty successful Factory selection instead of recommending rejected candidates', async () => {
    const select = jest.fn().mockResolvedValue([]);
    service = new RecommendationRequestsService(repository, search, {
      getOrThrow: () => ({ maxConcurrentExecutions: 1, selectionProvider: 'factory' }),
    } as unknown as ConfigService, { select } as unknown as FactorySelectionService);
    complete.mockResolvedValue({ request, recommendations: [] });
    const notification = await service.execute(request);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ resultPayload: [] }));
    expect(notification).toEqual(expect.objectContaining({ recommendations: [], explanations: [] }));
  });

  it('uses Factory mode with multiple results by default and falls back within retrieved candidates', async () => {
    const select = jest.fn().mockRejectedValue(new Error('upstream unavailable'));
    service = new RecommendationRequestsService(repository, search, {
      getOrThrow: () => ({ maxConcurrentExecutions: 1, selectionProvider: 'factory' }),
    } as unknown as ConfigService, { select } as unknown as FactorySelectionService);
    await service.createPending({ conversationId: request.conversationId, query: request.query });
    expect(createPending).toHaveBeenCalledWith(expect.objectContaining({ topK: 3 }));
    await service.execute(request);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      resultPayload: [expect.objectContaining({ testId: 'vector-first' })],
    }));
    expect(service.getLoadSnapshot().activeExecutions).toBe(0);
  });

  it('persists a normalized pending request before model calls', async () => {
    await service.createPending({
      conversationId: 'conversation-id',
      query: '  Нужен медицинский бенчмарк  ',
    });

    expect(createPending).toHaveBeenCalledWith({
      id: expect.any(String),
      conversationId: 'conversation-id',
      query: 'Нужен медицинский бенчмарк',
      topK: 1,
    });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('preserves hybrid retrieval order, takes topK and completes without network calls', async () => {
    const externalFetch = jest.spyOn(globalThis, 'fetch');
    const notification = await service.execute(request);

    expect(externalFetch).not.toHaveBeenCalled();
    externalFetch.mockRestore();
    expect(retrieve).toHaveBeenCalledWith(request.query);
    expect(complete).toHaveBeenCalledWith({
      id: request.id,
      retrievalVersion: 'gigachat:dim-1024:pgvector-fts-ru-en-rrf60-v1',
      retrievalDurationMs: 12,
      candidatePayload: candidates,
      rerankerVersion: null,
      resultPayload: [{
        testId: 'vector-first',
        rank: 1,
        score: 0.93,
        rerankScore: null,
        sourceUpdatedAt: '2026-08-25T12:00:00.000Z',
      }],
    });
    expect(notification).toEqual(expect.objectContaining({
      status: 'completed',
      requestId: request.id,
    }));
  });

  it('persists text-only fallback results without calling an external ranking service', async () => {
    retrieve.mockResolvedValue({ candidates, retrievalVersion: 'postgres-fts-ru-en-v1', durationMs: 15, fallbackReason: 'embedding_failed' });

    await service.execute(request);

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        rerankerVersion: null,
        resultPayload: [expect.objectContaining({
          testId: 'vector-first',
          rerankScore: null,
        })],
      })
    );
    expect(fail).not.toHaveBeenCalled();
  });

  it('persists a failed request if retrieval/embedder fails', async () => {
    retrieve.mockRejectedValue(new Error('embedding timeout'));
    fail.mockResolvedValue({
      ...request,
      status: RecommendationRequestStatus.failed,
      errorCode: 'RECOMMENDATION_SEARCH_FAILED',
      errorMessage: 'embedding timeout',
      retryable: true,
    });

    const notification = await service.execute(request);

    expect(fail).toHaveBeenCalledWith({
      id: request.id,
      errorCode: 'RECOMMENDATION_SEARCH_FAILED',
      errorMessage: 'embedding timeout',
      retryable: true,
    });
    expect(notification).toEqual(expect.objectContaining({ status: 'failed' }));
  });

  it('rejects invalid query and topK before persistence', async () => {
    await expect(service.createPending({
      conversationId: 'conversation-id',
      query: '   ',
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createPending({
      conversationId: 'conversation-id',
      query: 'query',
      topK: 101,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(createPending).not.toHaveBeenCalled();
  });

  it('fails excess concurrent executions without calling ML providers', async () => {
    service = recommendationService(repository, search, 1);
    let releaseRetrieval!: () => void;
    retrieve.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseRetrieval = () => resolve({
            candidates,
            retrievalVersion: 'gigachat:dim-1024:pgvector-fts-ru-en-rrf60-v1',
            durationMs: 12,
          });
        })
    );
    const overloadedRequest = {
      ...request,
      id: '02b6f21d-bd0b-4c91-afd4-222d885e429b',
    };
    fail.mockResolvedValueOnce({
      ...overloadedRequest,
      status: RecommendationRequestStatus.failed,
      errorCode: 'RECOMMENDATION_OVERLOADED',
      errorMessage: 'Recommendation service is at capacity; retry later',
      retryable: true,
    });

    const running = service.execute(request);
    await flushPromises();
    expect(service.getLoadSnapshot()).toEqual({
      activeExecutions: 1,
      maxConcurrentExecutions: 1,
    });

    const overloaded = await service.execute(overloadedRequest);

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledWith({
      id: overloadedRequest.id,
      errorCode: 'RECOMMENDATION_OVERLOADED',
      errorMessage: 'Recommendation service is at capacity; retry later',
      retryable: true,
    });
    expect(overloaded).toEqual(
      expect.objectContaining({
        status: 'failed',
        errorCode: 'RECOMMENDATION_OVERLOADED',
        retryable: true,
      })
    );

    releaseRetrieval();
    await running;
    expect(service.getLoadSnapshot().activeExecutions).toBe(0);
  });
});

function recommendationService(
  repository: IRecommendationRequestsRepository,
  search: BenchmarkSearchService,
  maxConcurrentExecutions = 16
): RecommendationRequestsService {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue({ maxConcurrentExecutions }),
  } as unknown as ConfigService;
  return new RecommendationRequestsService(
    repository,
    search,
    configService
  );
}

function recommendationRequest(): RecommendationRequest {
  const now = new Date('2026-08-25T12:00:00.000Z');
  return {
    id: 'f2cc095f-c816-4581-9661-fc470bd25b3d',
    conversationId: 'e01df09d-9e98-4386-9c8e-8d3bab29de60',
    query: 'Нужен медицинский бенчмарк',
    topK: 1,
    status: RecommendationRequestStatus.pending,
    attemptCount: 1,
    maxAttempts: 1,
    nextRetryAt: null,
    retrievalVersion: null,
    candidatePayload: null,
    rerankerVersion: null,
    retrievalDurationMs: null,
    resultPayload: null,
    errorCode: null,
    errorMessage: null,
    retryable: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
