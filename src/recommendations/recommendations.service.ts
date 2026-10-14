import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Recommendation } from '@/generated/prisma/client';
import { IRecommendationsRepository } from './repository/recommendations.repository.interface';
import {
  CreateRecommendationsParams,
  UpdateRecommendationStatusParams,
  UpdateRecommendationStatusResult,
} from './types';

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    @Inject(IRecommendationsRepository)
    private readonly repository: IRecommendationsRepository
  ) {}

  async createMany(
    params: CreateRecommendationsParams
  ): Promise<Recommendation[]> {
    this.logger.debug(
      `Persisting recommendations for conversationId="${params.conversationId}"`
    );

    return this.repository.createMany({
      conversationId: params.conversationId,
      testIds: params.testIds,
    });
  }

  async findByConversationId(
    conversationId: string
  ): Promise<Recommendation[]> {
    this.logger.debug(
      `Fetching recommendations for conversationId="${conversationId}"`
    );

    return this.repository.findByConversationId(conversationId);
  }

  async findByConversationAndTest(
    conversationId: string,
    testId: string
  ): Promise<Recommendation | null> {
    return this.repository.findByConversationAndTest(conversationId, testId);
  }

  async findById(id: string): Promise<Recommendation> {
    const recommendation = await this.repository.findById(id);
    if (!recommendation) {
      throw new NotFoundException(`Recommendation "${id}" was not found`);
    }
    return recommendation;
  }

  async findByIdForUser(
    id: string,
    userId: string
  ): Promise<Recommendation> {
    const recommendation = await this.repository.findByIdForUser(id, userId);
    if (!recommendation) {
      throw new NotFoundException(`Recommendation "${id}" was not found`);
    }
    return recommendation;
  }

  async updateStatus(
    params: UpdateRecommendationStatusParams
  ): Promise<UpdateRecommendationStatusResult> {
    const recommendation = await this.repository.findById(params.id);
    if (!recommendation) {
      throw new NotFoundException(
        `Recommendation "${params.id}" was not found`
      );
    }
    if (params.status === recommendation.status) {
      return { recommendation, transitioned: false };
    }
    if ('pending' !== recommendation.status) {
      throw new BadRequestException(
        `Recommendation "${params.id}" is already ${recommendation.status}`
      );
    }

    const updated = await this.repository.updatePendingStatus(
      params.id,
      params.status
    );
    if (updated) return { recommendation: updated, transitioned: true };

    // Another handler/process won the compare-and-set between our read and
    // update. A duplicate of the same command is idempotent; an opposite
    // command remains a conflict.
    const current = await this.repository.findById(params.id);
    if (current?.status === params.status) {
      return { recommendation: current, transitioned: false };
    }

    if (!current) {
      throw new NotFoundException(
        `Recommendation "${params.id}" was not found`
      );
    }

    throw new BadRequestException(
      `Recommendation "${params.id}" is already ${current.status}`
    );
  }
}
