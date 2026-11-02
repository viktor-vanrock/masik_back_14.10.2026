import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

import {
  KafkaProcessingFailureStatus,
  Prisma,
} from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

import { KafkaMessageMetadata } from './contracts/kafka-message-metadata';
import {
  IKafkaDeadLetterRepository,
  KafkaProcessingFailureResult,
  RecordKafkaProcessingFailureParams,
} from './dead-letter.repository.interface';
const MAX_STORED_ERROR_LENGTH = 2_000;

@Injectable()
export class KafkaDeadLetterRepository
implements IKafkaDeadLetterRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async recordFailure(
    params: RecordKafkaProcessingFailureParams
  ): Promise<KafkaProcessingFailureResult> {
    const { metadata } = params.message;

    return this.prisma.$transaction(async (transaction) => {
      const existing =
        await transaction.kafkaProcessingFailure.findUnique({
          where: {
            topic_partition_offset: {
              topic: metadata.topic,
              partition: metadata.partition,
              offset: BigInt(metadata.offset),
            },
          },
        });

      /**
       * После crash между DB commit и Kafka offset commit исходная запись
       * придёт повторно. Повторный DLQ event не создаём: он уже в Outbox.
       */
      if (
        existing?.status ===
        KafkaProcessingFailureStatus.dead_lettered
      ) {
        return {
          disposition: 'dead_lettered',
          attempts: existing.attempts,
          deadLetterEventId: existing.deadLetterEventId,
        };
      }

      const attempts = (existing?.attempts ?? 0) + 1;
      const now = new Date();
      const lastError = params.error.slice(
        0,
        MAX_STORED_ERROR_LENGTH
      );

      if (attempts < params.maxAttempts) {
        await transaction.kafkaProcessingFailure.upsert({
          where: {
            topic_partition_offset: {
              topic: metadata.topic,
              partition: metadata.partition,
              offset: BigInt(metadata.offset),
            },
          },
          create: {
            topic: metadata.topic,
            partition: metadata.partition,
            offset: BigInt(metadata.offset),
            messageKey: params.message.key,
            attempts,
            lastError,
          },
          update: {
            attempts,
            lastError,
            status: KafkaProcessingFailureStatus.retrying,
            resolvedAt: null,
          },
        });

        return {
          disposition: 'retry',
          attempts,
          deadLetterEventId: null,
        };
      }

      const deadLetterEventId = randomUUID();
      const payload = {
        eventId: deadLetterEventId,
        eventType: params.deadLetter.eventType,
        eventVersion: 2,
        occurredAt: now.toISOString(),
        data: {
          sourceTopic: metadata.topic,
          sourcePartition: metadata.partition,
          sourceOffset: metadata.offset,
          sourceKey: params.message.key,
          sourceValue: params.message.value,
          sourceHeaders: params.message.headers,
          processingError: lastError,
          attempts,
        },
      } satisfies Prisma.InputJsonObject;

      await transaction.kafkaProcessingFailure.upsert({
        where: {
          topic_partition_offset: {
            topic: metadata.topic,
            partition: metadata.partition,
            offset: BigInt(metadata.offset),
          },
        },
        create: {
          topic: metadata.topic,
          partition: metadata.partition,
          offset: BigInt(metadata.offset),
          messageKey: params.message.key,
          attempts,
          lastError,
          status: KafkaProcessingFailureStatus.dead_lettered,
          deadLetterEventId,
          deadLetteredAt: now,
        },
        update: {
          attempts,
          lastError,
          status: KafkaProcessingFailureStatus.dead_lettered,
          deadLetterEventId,
          deadLetteredAt: now,
          resolvedAt: null,
        },
      });

      /**
       * DLQ публикуется через Outbox. Поэтому offset исходной записи можно
       * коммитить сразу после этой транзакции: публикация переживёт restart.
       */
      await transaction.outboxMessage.create({
        data: {
          id: deadLetterEventId,
          topic: params.deadLetter.topic,
          // UUID гарантированно помещается в message_key VARCHAR(255).
          messageKey: params.message.key ?? deadLetterEventId,
          eventType: params.deadLetter.eventType,
          aggregateType: 'kafka-message',
          aggregateId: deadLetterEventId,
          payload,
        },
      });

      return {
        disposition: 'dead_lettered',
        attempts,
        deadLetterEventId,
      };
    });
  }

  async markResolved(metadata: KafkaMessageMetadata): Promise<void> {
    await this.prisma.kafkaProcessingFailure.updateMany({
      where: {
        topic: metadata.topic,
        partition: metadata.partition,
        offset: BigInt(metadata.offset),
        status: KafkaProcessingFailureStatus.retrying,
      },
      data: {
        status: KafkaProcessingFailureStatus.resolved,
        resolvedAt: new Date(),
      },
    });
  }
}
