import {
  Recommendation,
  RecommendationRequest,
} from '@/generated/prisma/client';
import {
  RecommendationCandidateSnapshot,
  RecommendationResultItem,
} from '../types';

export type CreatePendingRecommendationRequestInput = Readonly<{
  id: string;
  conversationId: string;
  query: string;
  topK: number;
}>;

export type CompleteRecommendationRequestInput = Readonly<{
  id: string;
  retrievalVersion: string;
  retrievalDurationMs: number;
  candidatePayload: readonly RecommendationCandidateSnapshot[];
  rerankerVersion: string | null;
  resultPayload: readonly RecommendationResultItem[];
}>;

export type FailRecommendationRequestInput = Readonly<{
  id: string;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
}>;

export type CompletedRecommendationRequest = Readonly<{
  request: RecommendationRequest;
  recommendations: readonly Recommendation[];
}>;

export abstract class IRecommendationRequestsRepository {
  abstract createPending(
    data: CreatePendingRecommendationRequestInput,
  ): Promise<RecommendationRequest>;

  abstract complete(
    data: CompleteRecommendationRequestInput,
  ): Promise<CompletedRecommendationRequest>;

  abstract fail(
    data: FailRecommendationRequestInput,
  ): Promise<RecommendationRequest>;
}
