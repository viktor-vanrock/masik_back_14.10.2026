import {
  Recommendation,
  RecommendationStatus,
} from '@/generated/prisma/client';

export type CreateRecommendationsInput = {
  conversationId: string;
  testIds: string[];
};

export abstract class IRecommendationsRepository {
  abstract createMany(
    data: CreateRecommendationsInput,
  ): Promise<Recommendation[]>;

  abstract findByConversationId(
    conversationId: string,
  ): Promise<Recommendation[]>;

  abstract findById(id: string): Promise<Nullable<Recommendation>>;

  abstract findByIdForUser(
    id: string,
    userId: string,
  ): Promise<Nullable<Recommendation>>;

  abstract findByConversationAndTest(
    conversationId: string,
    testId: string
  ): Promise<Nullable<Recommendation>>;

  abstract updatePendingStatus(
    id: string,
    status: RecommendationStatus,
  ): Promise<Nullable<Recommendation>>;
}
