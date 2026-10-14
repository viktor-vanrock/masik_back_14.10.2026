import { Prisma, Recommendation } from '@/generated/prisma/client';
import { RecommendationStatus } from '@/generated/prisma/enums';

export const recommendationFullInclude = {
  conversation: true,
} satisfies Prisma.RecommendationInclude;

export type RecommendationWithConversation =
  Prisma.RecommendationGetPayload<{
    include: typeof recommendationFullInclude;
  }>;

export type CreateRecommendationsParams = {
  conversationId: string;
  testIds: string[];
};

export type UpdateRecommendationStatusParams = {
  id: string;
  status:
    | typeof RecommendationStatus.selected
    | typeof RecommendationStatus.rejected;
};

export type UpdateRecommendationStatusResult = Readonly<{
  recommendation: Recommendation;
  transitioned: boolean;
}>;

export type CreateRecommendationRequestParams = {
  conversationId: string;
  query: string;
  topK?: number;
};

export type RecommendationCandidateSnapshot = Readonly<{
  testId: string;
  document: string;
  score: number;
  sourceUpdatedAt: string;
}>;

export type RecommendationResultItem = Readonly<{
  explanation?: string;
  testId: string;
  rank: number;
  score: number;
  rerankScore: number | null;
  sourceUpdatedAt: string;
}>;

export type RecommendationResultNotification =
  | Readonly<{
    status: 'completed';
    requestId: string;
    conversationId: string;
    retrievalVersion: string;
    label?: string;
    recommendations: readonly Recommendation[];
    explanations?: readonly { testId: string; explanation?: string }[];
  }>
  | Readonly<{
    status: 'failed';
    requestId: string;
    conversationId: string;
    errorCode: string;
    message: string;
    retryable: boolean;
  }>;
