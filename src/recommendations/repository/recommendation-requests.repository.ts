import { Injectable } from '@nestjs/common';
import { publishedCatalogEntryWhere } from '@/catalog/catalog-entry/catalog-entry.visibility';
import {
  ConversationStatus,
  RecommendationRequest,
  RecommendationRequestStatus,
  RecommendationStatus,
} from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { RecommendationCandidateReferenceService } from './recommendation-candidate-reference.service';
import {
  CompleteRecommendationRequestInput,
  CompletedRecommendationRequest,
  CreatePendingRecommendationRequestInput,
  FailRecommendationRequestInput,
  IRecommendationRequestsRepository,
} from './recommendation-requests.repository.interface';

@Injectable()
export class RecommendationRequestsRepository
implements IRecommendationRequestsRepository
{
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidateReferences: RecommendationCandidateReferenceService
  ) {}

  createPending(
    data: CreatePendingRecommendationRequestInput
  ): Promise<RecommendationRequest> {
    return this.prisma.recommendationRequest.create({
      data: {
        ...data,
        attemptCount: 1,
        maxAttempts: 1,
      },
    });
  }

  complete(
    data: CompleteRecommendationRequestInput
  ): Promise<CompletedRecommendationRequest> {
    return this.prisma.$transaction(async (transaction) => {
      const pending = await transaction.recommendationRequest.findUnique({
        where: { id: data.id },
      });

      if (!pending) {
        throw new Error(`Recommendation request not found: "${data.id}"`);
      }
      if (RecommendationRequestStatus.pending !== pending.status) {
        throw new Error(
          `Recommendation request "${data.id}" is already ${pending.status}`
        );
      }

      const candidatesById = new Map(
        data.candidatePayload.map((candidate) => [
          candidate.testId,
          candidate,
        ])
      );
      const requestedIds = data.resultPayload.map(
        (item) => item.testId
      );
      const publishedEntries = 0 === requestedIds.length
        ? []
        : await transaction.catalogEntry.findMany({
          where: {
            testId: { in: requestedIds },
            ...publishedCatalogEntryWhere,
          },
          select: { testId: true },
        });
      const publishedIds = publishedEntries.map(({ testId }) => testId);
      const activeRows = await this.candidateReferences.findActiveVersions(
        transaction,
        publishedIds
      );
      const activeIds = new Set(
        activeRows
          .filter(
            (row) =>
              row.sourceUpdatedAt.toISOString() ===
              candidatesById.get(row.id)?.sourceUpdatedAt
          )
          .map((row) => row.id)
      );
      const activeResults = data.resultPayload.filter((item) =>
        activeIds.has(item.testId)
      );
      const completedAt = new Date();

      const request = await transaction.recommendationRequest.update({
        where: { id: data.id },
        data: {
          status: RecommendationRequestStatus.completed,
          retrievalVersion: data.retrievalVersion,
          retrievalDurationMs: data.retrievalDurationMs,
          candidatePayload: data.candidatePayload,
          rerankerVersion: data.rerankerVersion,
          resultPayload: activeResults,
          errorCode: null,
          errorMessage: null,
          retryable: null,
          nextRetryAt: null,
          completedAt,
        },
      });

      for (const item of activeResults) {
        await transaction.recommendation.upsert({
          where: {
            conversationId_testId: {
              conversationId: pending.conversationId,
              testId: item.testId,
            },
          },
          create: {
            conversationId: pending.conversationId,
            testId: item.testId,
          },
          update: { status: RecommendationStatus.pending },
        });
      }

      await transaction.conversation.update({
        where: { id: pending.conversationId },
        data: {
          status: activeResults.length > 0
            ? ConversationStatus.awaiting_choice
            : ConversationStatus.active,
        },
      });

      const recommendations = 0 === activeResults.length
        ? []
        : await transaction.recommendation.findMany({
          where: {
            conversationId: pending.conversationId,
            testId: {
              in: activeResults.map((item) => item.testId),
            },
          },
          orderBy: { createdAt: 'asc' },
        });

      const rankById = new Map(activeResults.map((item) => [item.testId, item.rank]));
      recommendations.sort((left, right) =>
        (rankById.get(left.testId) ?? 0) - (rankById.get(right.testId) ?? 0)
      );
      return { request, recommendations };
    });
  }

  fail(
    data: FailRecommendationRequestInput
  ): Promise<RecommendationRequest> {
    return this.prisma.recommendationRequest.update({
      where: { id: data.id },
      data: {
        status: RecommendationRequestStatus.failed,
        errorCode: data.errorCode,
        errorMessage: data.errorMessage,
        retryable: data.retryable,
        nextRetryAt: null,
        completedAt: new Date(),
      },
    });
  }

}
