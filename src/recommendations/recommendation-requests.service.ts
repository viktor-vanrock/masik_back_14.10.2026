import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BenchmarkSearchService } from '@/catalog/search/benchmark-search.service';
import { RecommendationRequest } from '@/generated/prisma/client';
import { FactorySelectionService } from './factory-selection.service';
import { IRecommendationRequestsRepository } from './repository/recommendation-requests.repository.interface';
import {
  CreateRecommendationRequestParams,
  RecommendationResultItem,
  RecommendationResultNotification,
} from './types';
import type { RecommendationEnvType } from '@/configs/types';

const MAX_TOP_K = 20;

@Injectable()
export class RecommendationRequestsService {
  private readonly logger = new Logger(RecommendationRequestsService.name);
  private readonly maxConcurrentExecutions: number;
  private activeExecutions = 0;
  private readonly selectionProvider: 'retrieval' | 'factory';

  constructor(
    @Inject(IRecommendationRequestsRepository)
    private readonly repository: IRecommendationRequestsRepository,
    private readonly benchmarkSearchService: BenchmarkSearchService,
    configService: ConfigService,
    @Optional() private readonly selection?: FactorySelectionService
  ) {
    this.selectionProvider = configService.getOrThrow<RecommendationEnvType>('recommendation').selectionProvider ?? 'retrieval';
    this.maxConcurrentExecutions =
      configService.getOrThrow<RecommendationEnvType>(
        'recommendation'
      ).maxConcurrentExecutions;
  }

  async createPending(
    params: CreateRecommendationRequestParams
  ): Promise<RecommendationRequest> {
    const query = params.query.trim();
    const topK = params.topK ?? ('factory' === this.selectionProvider ? 3 : 1);

    if (!query) {
      throw new BadRequestException(
        'Recommendation query must not be empty'
      );
    }

    if (!Number.isInteger(topK) || topK < 1 || topK > MAX_TOP_K) {
      throw new BadRequestException(
        `Recommendation topK must be between 1 and ${MAX_TOP_K}`
      );
    }

    return this.repository.createPending({
      id: randomUUID(),
      conversationId: params.conversationId,
      query,
      topK,
    });
  }

  async execute(
    request: RecommendationRequest
  ): Promise<RecommendationResultNotification> {
    if (this.activeExecutions >= this.maxConcurrentExecutions) {
      this.logger.warn(
        'Recommendation capacity exhausted: ' +
        `active=${this.activeExecutions}, ` +
        `limit=${this.maxConcurrentExecutions}, requestId="${request.id}"`
      );
      return this.failRequest(
        request,
        'RECOMMENDATION_OVERLOADED',
        'Recommendation service is at capacity; retry later'
      );
    }

    this.activeExecutions += 1;
    try {
      const retrieval = await this.benchmarkSearchService.retrieve(
        request.query
      );
      const ranking = await this.rankCandidates(
        request.query,
        retrieval.candidates,
        request.id,
        request.topK
      );
      const selected = ranking.candidates.slice(0, request.topK);
      const resultPayload: RecommendationResultItem[] = selected.map(
        ({ candidate, rerankScore, explanation }, index) => ({
          testId: candidate.testId,
          rank: index + 1,
          score: candidate.score,
          rerankScore,
          sourceUpdatedAt: candidate.sourceUpdatedAt,
          ...(explanation ? { explanation } : {}),
        })
      );

      const completed = await this.repository.complete({
        id: request.id,
        retrievalVersion: retrieval.retrievalVersion,
        retrievalDurationMs: retrieval.durationMs,
        candidatePayload: retrieval.candidates,
        rerankerVersion: ranking.rerankerVersion,
        resultPayload,
      });

      this.logger.log(
        'Recommendation request completed: ' +
        `requestId="${request.id}", candidates=${retrieval.candidates.length}, ` +
        `results=${completed.recommendations.length}, ` +
        `reranker="${ranking.rerankerVersion ?? 'postgres-retrieval'}"`
      );

      return {
        status: 'completed',
        requestId: completed.request.id,
        conversationId: completed.request.conversationId,
        retrievalVersion: retrieval.retrievalVersion,
        recommendations: completed.recommendations,
        explanations: resultPayload.filter((item) => completed.recommendations.some(
          (recommendation) => recommendation.testId === item.testId
        )).map(({ testId, explanation }) => ({ testId, explanation })),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Recommendation request failed: requestId="${request.id}", ` +
        `error="${message}"`
      );

      return this.failRequest(
        request,
        'RECOMMENDATION_SEARCH_FAILED',
        message
      );
    } finally {
      this.activeExecutions -= 1;
    }
  }

  getLoadSnapshot(): {
    activeExecutions: number;
    maxConcurrentExecutions: number;
  } {
    return {
      activeExecutions: this.activeExecutions,
      maxConcurrentExecutions: this.maxConcurrentExecutions,
    };
  }

  private async failRequest(
    request: RecommendationRequest,
    errorCode: string,
    message: string
  ): Promise<RecommendationResultNotification> {
    const failed = await this.repository.fail({
      id: request.id,
      errorCode,
      errorMessage: message,
      retryable: true,
    });

    return {
      status: 'failed',
      requestId: failed.id,
      conversationId: failed.conversationId,
      errorCode: failed.errorCode ?? errorCode,
      message: failed.errorMessage ?? message,
      retryable: failed.retryable ?? true,
    };
  }

  private async rankCandidates(
    query: string,
    candidates: Awaited<ReturnType<BenchmarkSearchService['retrieve']>>['candidates'],
    requestId: string,
    topK: number
  ): Promise<{
    candidates: readonly {
      candidate: (typeof candidates)[number];
      rerankScore: number | null;
      explanation?: string;
    }[];
    rerankerVersion: string | null;
  }> {
    if (0 === candidates.length) {
      return { candidates: [], rerankerVersion: null };
    }

    if ('factory' === this.selectionProvider) {
      if (!this.selection) throw new Error('Factory selection is not configured');
      try {
        const selected = await this.selection.select(requestId, query, candidates, topK);
        const candidatesById = new Map(candidates.map((candidate) => [candidate.testId, candidate]));
        const ranked = selected.map(({ testId, explanation }) => {
          const candidate = candidatesById.get(testId);
          if (!candidate) throw new Error('Factory selected an unknown candidate');
          return { candidate, rerankScore: null, explanation };
        });
        return {
          candidates: ranked,
          rerankerVersion: 'factory-selection-v1',
        };
      } catch {
        this.logger.warn(`Factory selection unavailable: requestId="${requestId}", using retrieval order`);
        return {
          candidates: candidates.map((candidate) => ({ candidate, rerankScore: null })),
          rerankerVersion: null,
        };
      }
    }

    // Hybrid pgvector/FTS already determines the order. No separate model
    // endpoint is needed; this also applies to text-only fallback results.
    return {
      candidates: candidates.map((candidate) => ({ candidate, rerankScore: null })),
      rerankerVersion: null,
    };
  }
}
