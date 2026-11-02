import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { OutboxMessage, Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { FindPendingOutboxMessagesParams, IOutboxRepository, MarkOutboxMessageFailedParams, MarkOutboxMessagePublishedParams } from './outbox.repository.interface';

@Injectable()
export class OutboxRepository implements IOutboxRepository {
  private static readonly LEASE_MS = 30_000;

  constructor(private readonly prisma: PrismaService) {}

  async findPending(params: FindPendingOutboxMessagesParams): Promise<OutboxMessage[]> {
    const leaseExpiredBefore = new Date(
      params.availableBefore.getTime() - OutboxRepository.LEASE_MS
    );
    const claimToken = randomUUID();

    // Claim only the oldest unpublished row for a Kafka topic+key. Without
    // this head-of-line condition two application replicas can publish an
    // update before the corresponding create and cause a false version
    // conflict in benchmark-service.
    return this.prisma.$queryRaw<OutboxMessage[]>(Prisma.sql`
      WITH candidates AS (
        SELECT candidate.id, candidate.created_at
        FROM outbox_messages AS candidate
        WHERE candidate.published_at IS NULL
          AND candidate.available_at <= ${params.availableBefore}
          AND (
            candidate.claimed_at IS NULL
            OR candidate.claimed_at < ${leaseExpiredBefore}
          )
          AND NOT EXISTS (
            SELECT 1
            FROM outbox_messages AS predecessor
            WHERE predecessor.topic = candidate.topic
              AND predecessor.message_key = candidate.message_key
              AND predecessor.published_at IS NULL
              AND (
                predecessor.created_at < candidate.created_at
                OR (
                  predecessor.created_at = candidate.created_at
                  AND predecessor.id < candidate.id
                )
              )
          )
        ORDER BY candidate.created_at ASC, candidate.id ASC
        LIMIT ${params.limit}
        FOR UPDATE SKIP LOCKED
      ), claimed AS (
        UPDATE outbox_messages AS message
        SET claimed_at = ${params.availableBefore},
            claim_token = ${claimToken}::uuid,
            updated_at = ${params.availableBefore}
        FROM candidates
        WHERE message.id = candidates.id
        RETURNING message.*
      )
      SELECT
        claimed.id,
        claimed.topic,
        claimed.message_key AS "messageKey",
        claimed.event_type AS "eventType",
        claimed.aggregate_type AS "aggregateType",
        claimed.aggregate_id AS "aggregateId",
        claimed.deduplication_key AS "deduplicationKey",
        claimed.payload,
        claimed.attempts,
        claimed.available_at AS "availableAt",
        claimed.published_at AS "publishedAt",
        claimed.claimed_at AS "claimedAt",
        claimed.claim_token AS "claimToken",
        claimed.last_error AS "lastError",
        claimed.created_at AS "createdAt",
        claimed.updated_at AS "updatedAt"
      FROM claimed
      INNER JOIN candidates ON candidates.id = claimed.id
      ORDER BY candidates.created_at ASC, claimed.id ASC
    `);
  }

  async markPublished(params: MarkOutboxMessagePublishedParams): Promise<boolean> {
    const result = await this.prisma.outboxMessage.updateMany({
      where: {
        id: params.id,

        // Уже опубликованную строку повторно не изменяем
        publishedAt: null,
        claimToken: params.claimToken,
      },
      data: {
        publishedAt: params.publishedAt,

        // Предыдущая ошибка больше не актуальна
        lastError: null,
        claimedAt: null,
        claimToken: null,
      },
    });

    return 1 === result.count;
  }

  async markFailed(params: MarkOutboxMessageFailedParams): Promise<boolean> {
    const result = await this.prisma.outboxMessage.updateMany({
      where: {
        id: params.id,

        // Не портим строку, если другой publisher уже ее опубликовал
        publishedAt: null,
        claimToken: params.claimToken,
      },
      data: {
        attempts: {
          increment: 1,
        },
        availableAt: params.availableAt,
        lastError: params.lastError,
        claimedAt: null,
        claimToken: null,
      },
    });

    return 1 === result.count;
  }
}
