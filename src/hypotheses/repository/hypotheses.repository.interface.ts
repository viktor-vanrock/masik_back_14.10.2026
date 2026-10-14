import {
  HypothesisGeneration,
  HypothesisGenerationStatus,
} from '@/generated/prisma/client';
import {
  CreateGenerationParams,
  HypothesisGenerationWithHypotheses,
} from '../types';

export abstract class IHypothesesRepository {
  abstract createGeneration(
    params: CreateGenerationParams,
  ): Promise<HypothesisGenerationWithHypotheses>;

  abstract findByConversationId(
    conversationId: string,
  ): Promise<HypothesisGenerationWithHypotheses[]>;

  abstract findById(
    id: string,
  ): Promise<Nullable<HypothesisGenerationWithHypotheses>>;

  abstract updateGenerationStatus(
    id: string,
    status: HypothesisGenerationStatus,
  ): Promise<HypothesisGeneration>;
}
