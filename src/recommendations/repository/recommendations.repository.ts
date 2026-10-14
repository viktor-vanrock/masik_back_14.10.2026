import { Injectable, Logger } from '@nestjs/common';
import {
  Recommendation,
  RecommendationStatus,
} from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  CreateRecommendationsInput,
  IRecommendationsRepository,
} from './recommendations.repository.interface';

@Injectable()
export class RecommendationsRepository implements IRecommendationsRepository {
  private readonly logger = new Logger(RecommendationsRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async createMany(
    data: CreateRecommendationsInput
  ): Promise<Recommendation[]> {
    const { conversationId, testIds } = data;

    this.logger.debug(
      `Creating recommendations: conversationId="${conversationId}", count=${testIds.length}`
    );

    await this.prisma.recommendation.createMany({
      data: testIds.map((testId) => ({ conversationId, testId })),
      skipDuplicates: true,
    });

    const recommendations = await this.prisma.recommendation.findMany({
      where: { conversationId, testId: { in: testIds } },
    });

    this.logger.log(
      `Recommendations created: conversationId="${conversationId}", count=${recommendations.length}`
    );

    return recommendations;
  }

  async findByConversationId(
    conversationId: string
  ): Promise<Recommendation[]> {
    this.logger.debug(
      `Fetching recommendations: conversationId="${conversationId}"`
    );

    return this.prisma.recommendation.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findById(id: string): Promise<Nullable<Recommendation>> {
    return this.prisma.recommendation.findUnique({
      where: { id },
    });
  }

  async findByIdForUser(
    id: string,
    userId: string
  ): Promise<Nullable<Recommendation>> {
    return this.prisma.recommendation.findFirst({
      where: {
        id,
        conversation: { userId },
      },
    });
  }

  async findByConversationAndTest(
    conversationId: string,
    testId: string
  ): Promise<Nullable<Recommendation>> {
    return this.prisma.recommendation.findUnique({
      where: { conversationId_testId: { conversationId, testId } },
    });
  }

  async updatePendingStatus(
    id: string,
    status: RecommendationStatus
  ): Promise<Nullable<Recommendation>> {
    return this.prisma.$transaction(async (transaction) => {
      const transition = await transaction.recommendation.updateMany({
        where: { id, status: RecommendationStatus.pending },
        data: { status },
      });

      if (0 === transition.count) return null;

      return transaction.recommendation.findUniqueOrThrow({
        where: { id },
      });
    });
  }
}
