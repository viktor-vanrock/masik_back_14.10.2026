import { Injectable, Logger } from '@nestjs/common';
import {
  HypothesisGeneration,
  HypothesisGenerationStatus,
} from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  CreateGenerationParams,
  HypothesisGenerationWithHypotheses,
  hypothesisGenerationFullInclude,
} from '../types';
import { IHypothesesRepository } from './hypotheses.repository.interface';

@Injectable()
export class HypothesesRepository implements IHypothesesRepository {
  private readonly logger = new Logger(HypothesesRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async createGeneration(
    params: CreateGenerationParams
  ): Promise<HypothesisGenerationWithHypotheses> {
    this.logger.debug(
      `Creating hypothesis generation (tx): conversationId="${params.conversationId}", count=${params.hypotheses.length}`
    );

    return this.prisma.$transaction(async (tx) => {
      // Берём advisory-блокировку на время транзакции (ключ — хэш conversationId).
      // Она сериализует выдачу attemptNumber только для одного и того же чата
      // (разные чаты друг друга не блокируют) и сама снимается на commit/rollback.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${params.conversationId}, 0))`;

      const count = await tx.hypothesisGeneration.count({
        where: { conversationId: params.conversationId },
      });
      const attemptNumber = count + 1;

      const generation = await tx.hypothesisGeneration.create({
        data: {
          conversationId: params.conversationId,
          testId: params.testId,
          attemptNumber,
          status: HypothesisGenerationStatus.pending,
        },
      });

      if (params.hypotheses.length > 0) {
        await tx.hypothesis.createMany({
          data: params.hypotheses.map((content) => ({
            generationId: generation.id,
            content,
          })),
        });
      } else {
        this.logger.warn(
          `No hypotheses to persist for generationId="${generation.id}"`
        );
      }

      const completed = await tx.hypothesisGeneration.update({
        where: { id: generation.id },
        data: { status: HypothesisGenerationStatus.completed },
        include: hypothesisGenerationFullInclude,
      });

      this.logger.log(
        `Hypothesis generation completed: id="${completed.id}", conversationId="${params.conversationId}", attemptNumber=${attemptNumber}, count=${params.hypotheses.length}`
      );

      return completed;
    });
  }

  async findByConversationId(
    conversationId: string
  ): Promise<HypothesisGenerationWithHypotheses[]> {
    this.logger.debug(
      `Fetching hypothesis generations: conversationId="${conversationId}"`
    );

    return this.prisma.hypothesisGeneration.findMany({
      where: { conversationId },
      orderBy: { attemptNumber: 'asc' },
      include: hypothesisGenerationFullInclude,
    });
  }

  async findById(
    id: string
  ): Promise<Nullable<HypothesisGenerationWithHypotheses>> {
    return this.prisma.hypothesisGeneration.findUnique({
      where: { id },
      include: hypothesisGenerationFullInclude,
    });
  }

  async updateGenerationStatus(
    id: string,
    status: HypothesisGenerationStatus
  ): Promise<HypothesisGeneration> {
    return this.prisma.hypothesisGeneration.update({
      where: { id },
      data: { status },
    });
  }
}
