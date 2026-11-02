import { Injectable } from '@nestjs/common';
import {
  BENCHMARK_MESSAGE_TYPES,
  BenchmarkIntegrationMessageV1,
  BenchmarkTestSpecificationV1,
  parseBenchmarkIntegrationMessageV1,
} from '@/benchmark-service/contracts/benchmark-integration.v1';
import { BenchmarkValidationStatus, Prisma } from '@/generated/prisma/client';
import { KafkaMessageMetadata } from '@/kafka/contracts/kafka-message-metadata';
import { KAFKA_TOPICS } from '@/kafka/kafka.constants';
import { PrismaService } from '@/prisma/prisma.service';

export type CatalogProjectionApplyResult = Readonly<{
  disposition: 'applied' | 'duplicate' | 'stale';
  eventId: string;
  aggregateId: string;
  aggregateVersion: number;
}>;

@Injectable()
export class CatalogBenchmarkProjectionService {
  constructor(private readonly prisma: PrismaService) {}

  async apply(
    value: unknown,
    metadata: KafkaMessageMetadata
  ): Promise<CatalogProjectionApplyResult> {
    const message = parseBenchmarkIntegrationMessageV1(value);
    this.assertProjectionEvent(message);
    const offset = this.parseOffset(metadata.offset);

    return this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.inboxMessage.findUnique({
        where: { id: message.eventId },
        select: { id: true },
      });
      if (duplicate) return this.result('duplicate', message);

      const occupiedPosition = await tx.inboxMessage.findUnique({
        where: {
          topic_partition_offset: {
            topic: metadata.topic,
            partition: metadata.partition,
            offset,
          },
        },
        select: { id: true },
      });
      if (occupiedPosition) {
        throw new Error(
          'Kafka position was already processed with another eventId: ' +
            `topic="${metadata.topic}", partition=${metadata.partition}, ` +
            `offset=${metadata.offset}`
        );
      }

      const disposition = await this.applyProjection(tx, message);
      if (BENCHMARK_MESSAGE_TYPES.commandRejected !== message.eventType) {
        await this.recordAppliedCommandOutcome(tx, message);
      }

      await tx.inboxMessage.create({
        data: {
          id: message.eventId,
          topic: metadata.topic,
          partition: metadata.partition,
          offset,
          eventType: message.eventType,
          aggregateType: message.aggregateType,
          aggregateId: message.aggregateId.toLowerCase(),
        },
      });

      return this.result(disposition, message);
    });
  }

  private async applyProjection(
    tx: Prisma.TransactionClient,
    message: BenchmarkIntegrationMessageV1
  ): Promise<'applied' | 'stale'> {
    switch (message.eventType) {
      case BENCHMARK_MESSAGE_TYPES.suiteSnapshot: {
        const snapshot = message.data.benchmark;
        if (await this.isStaleSuite(tx, snapshot.id, snapshot.aggregateVersion)) {
          return 'stale';
        }
        await tx.catalogBenchmarkProjection.upsert({
          where: { benchmarkId: snapshot.id.toLowerCase() },
          create: {
            benchmarkId: snapshot.id.toLowerCase(),
            aggregateVersion: snapshot.aggregateVersion,
            name: snapshot.name,
            nameEn: snapshot.nameEn,
            description: snapshot.description,
            descriptionEn: snapshot.descriptionEn,
            deletedAt: snapshot.deletedAt,
            sourceCreatedAt: snapshot.createdAt,
            sourceUpdatedAt: snapshot.updatedAt,
          },
          update: {
            aggregateVersion: snapshot.aggregateVersion,
            name: snapshot.name,
            nameEn: snapshot.nameEn,
            description: snapshot.description,
            descriptionEn: snapshot.descriptionEn,
            deletedAt: snapshot.deletedAt,
            sourceCreatedAt: snapshot.createdAt,
            sourceUpdatedAt: snapshot.updatedAt,
            receivedAt: new Date(),
          },
        });
        return 'applied';
      }

      case BENCHMARK_MESSAGE_TYPES.suiteDeleted: {
        if (
          await this.isStaleSuite(
            tx,
            message.data.benchmarkId,
            message.aggregateVersion
          )
        ) {
          return 'stale';
        }
        await tx.catalogBenchmarkProjection.upsert({
          where: { benchmarkId: message.data.benchmarkId.toLowerCase() },
          create: {
            benchmarkId: message.data.benchmarkId.toLowerCase(),
            aggregateVersion: message.aggregateVersion,
            deletedAt: message.data.deletedAt,
            sourceUpdatedAt: message.data.deletedAt,
          },
          update: {
            aggregateVersion: message.aggregateVersion,
            deletedAt: message.data.deletedAt,
            sourceUpdatedAt: message.data.deletedAt,
            receivedAt: new Date(),
          },
        });
        return 'applied';
      }

      case BENCHMARK_MESSAGE_TYPES.testSnapshot: {
        const snapshot = message.data.test;
        const specification = snapshot.specification;
        if (await this.isStaleTest(tx, snapshot.id, snapshot.aggregateVersion)) {
          return 'stale';
        }
        await tx.catalogTestProjection.upsert({
          where: { testId: snapshot.id.toLowerCase() },
          create: {
            testId: snapshot.id.toLowerCase(),
            benchmarkId: snapshot.specification.suiteId.toLowerCase(),
            aggregateVersion: snapshot.aggregateVersion,
            snapshot: this.toJson(snapshot),
            ...this.testQueryFields(specification, snapshot.createdAt),
            deletedAt: snapshot.deletedAt,
            sourceUpdatedAt: snapshot.updatedAt,
          },
          update: {
            benchmarkId: snapshot.specification.suiteId.toLowerCase(),
            aggregateVersion: snapshot.aggregateVersion,
            snapshot: this.toJson(snapshot),
            ...this.testQueryFields(specification, snapshot.createdAt),
            deletedAt: snapshot.deletedAt,
            sourceUpdatedAt: snapshot.updatedAt,
            receivedAt: new Date(),
          },
        });
        return 'applied';
      }

      case BENCHMARK_MESSAGE_TYPES.testDeleted: {
        if (
          await this.isStaleTest(
            tx,
            message.data.testId,
            message.aggregateVersion
          )
        ) {
          return 'stale';
        }
        await tx.catalogTestProjection.upsert({
          where: { testId: message.data.testId.toLowerCase() },
          create: {
            testId: message.data.testId.toLowerCase(),
            aggregateVersion: message.aggregateVersion,
            deletedAt: message.data.deletedAt,
            sourceUpdatedAt: message.data.deletedAt,
          },
          update: {
            aggregateVersion: message.aggregateVersion,
            deletedAt: message.data.deletedAt,
            sourceUpdatedAt: message.data.deletedAt,
            receivedAt: new Date(),
          },
        });
        return 'applied';
      }

      case BENCHMARK_MESSAGE_TYPES.commandRejected: {
        await this.recordCommandOutcome(tx, message.data.commandEventId, message, {
          status: 'rejected',
          reasonCode: message.data.reasonCode,
          statusCode: message.data.statusCode ?? null,
          deletedId: message.data.deletedId ?? null,
          message: message.data.message.slice(0, 4_000),
        });
        return 'applied';
      }

      default:
        throw new Error(
          `Unsupported Catalog projection event: "${message.eventType}"`
        );
    }
  }

  private async recordAppliedCommandOutcome(
    tx: Prisma.TransactionClient,
    message: BenchmarkIntegrationMessageV1
  ): Promise<void> {
    if (!message.causationId) return;
    await this.recordCommandOutcome(tx, message.causationId, message, {
      status: 'applied',
      reasonCode: null,
      statusCode: null,
      deletedId: null,
      message: null,
    });
  }

  private async recordCommandOutcome(
    tx: Prisma.TransactionClient,
    commandEventId: string,
    response: BenchmarkIntegrationMessageV1,
    outcome: {
      status: 'applied' | 'rejected';
      reasonCode: string | null;
      statusCode: 400 | 404 | 409 | null;
      deletedId: string | null;
      message: string | null;
    }
  ): Promise<void> {
    const existing = await tx.benchmarkCommandOutcome.findUnique({
      where: { commandEventId },
      select: { responseEventId: true, status: true },
    });
    if (existing) {
      if (
        existing.responseEventId === response.eventId &&
        existing.status === outcome.status
      ) {
        return;
      }
      throw new Error(
        `Benchmark command "${commandEventId}" already has a different outcome`
      );
    }

    const command = await tx.outboxMessage.findUnique({
      where: { id: commandEventId },
      select: {
        id: true,
        topic: true,
        eventType: true,
        aggregateType: true,
        aggregateId: true,
      },
    });
    if (!command || KAFKA_TOPICS.benchmarkCommands !== command.topic) {
      // Projection topics are replayed from the beginning. Historical events
      // may have originated in another Catalog instance or outlived local
      // Outbox retention, so they must still be acknowledged and projected.
      return;
    }
    if (
      command.aggregateType !== response.aggregateType ||
      command.aggregateId.toLowerCase() !== response.aggregateId.toLowerCase()
    ) {
      throw new Error(
        `Benchmark response "${response.eventId}" does not match command aggregate`
      );
    }

    await tx.benchmarkCommandOutcome.create({
      data: {
        commandEventId,
        responseEventId: response.eventId,
        commandEventType: command.eventType,
        aggregateType: response.aggregateType,
        aggregateId: response.aggregateId.toLowerCase(),
        status: outcome.status,
        reasonCode: outcome.reasonCode,
        statusCode: outcome.statusCode,
        deletedId: outcome.deletedId,
        message: outcome.message,
        occurredAt: new Date(response.occurredAt),
      },
    });

    if (
      'applied' === outcome.status &&
      BENCHMARK_MESSAGE_TYPES.testRestoreRequested === command.eventType
    ) {
      const actor = await tx.benchmarkCommandActor.findUnique({
        where: { commandEventId },
      });
      if (actor?.resetSubmissionOnApplied) {
        await tx.catalogEntry.updateMany({
          where: { testId: command.aggregateId, authorId: actor.actorId },
          data: {
            status: BenchmarkValidationStatus.validation,
            rejectionReason: null,
            reviewedById: null,
            reviewedAt: null,
            archivedAt: null,
          },
        });
      }
    }

    if (
      'rejected' === outcome.status &&
      BENCHMARK_MESSAGE_TYPES.testCreateRequested === command.eventType
    ) {
      await tx.catalogEntry.deleteMany({
        where: { testId: command.aggregateId },
      });
    }
  }

  private async isStaleSuite(
    tx: Prisma.TransactionClient,
    id: string,
    version: number
  ): Promise<boolean> {
    const current = await tx.catalogBenchmarkProjection.findUnique({
      where: { benchmarkId: id.toLowerCase() },
      select: { aggregateVersion: true },
    });
    return Boolean(current && current.aggregateVersion >= version);
  }

  private async isStaleTest(
    tx: Prisma.TransactionClient,
    id: string,
    version: number
  ): Promise<boolean> {
    const current = await tx.catalogTestProjection.findUnique({
      where: { testId: id.toLowerCase() },
      select: { aggregateVersion: true },
    });
    return Boolean(current && current.aggregateVersion >= version);
  }

  private assertProjectionEvent(message: BenchmarkIntegrationMessageV1): void {
    if (
      ![
        BENCHMARK_MESSAGE_TYPES.suiteSnapshot,
        BENCHMARK_MESSAGE_TYPES.suiteDeleted,
        BENCHMARK_MESSAGE_TYPES.testSnapshot,
        BENCHMARK_MESSAGE_TYPES.testDeleted,
        BENCHMARK_MESSAGE_TYPES.commandRejected,
      ].includes(message.eventType as never)
    ) {
      throw new Error(
        `Catalog projection cannot consume "${message.eventType}"`
      );
    }
  }

  private parseOffset(value: string): bigint {
    let offset: bigint;
    try {
      offset = BigInt(value);
    } catch {
      throw new Error(`Kafka offset must be an integer: "${value}"`);
    }
    if (offset < 0n) throw new Error('Kafka offset must not be negative');
    return offset;
  }

  private result(
    disposition: CatalogProjectionApplyResult['disposition'],
    message: BenchmarkIntegrationMessageV1
  ): CatalogProjectionApplyResult {
    return {
      disposition,
      eventId: message.eventId,
      aggregateId: message.aggregateId.toLowerCase(),
      aggregateVersion: message.aggregateVersion,
    };
  }

  private testQueryFields(
    specification: BenchmarkTestSpecificationV1,
    createdAt: string
  ) {
    return {
      name: specification.name,
      nameEn: specification.nameEn,
      description: specification.description,
      descriptionEn: specification.descriptionEn,
      shortDescription: specification.shortDescription,
      taskDescription: specification.taskDescription,
      sizeInSamples: specification.sizeInSamples,
      macroGroupId: specification.macroGroupId,
      taskTypeId: specification.taskTypeId,
      languageId: specification.languageId,
      difficultyId: specification.difficultyId,
      subGroupIds: [...specification.subGroupIds],
      abilityTaxonIds: [...specification.abilityTaxonIds],
      domainIds: [...specification.domainIds],
      subdomainIds: [...specification.subdomainIds],
      modalityIds: [...specification.modalityIds],
      capabilityIds: [...specification.capabilityIds],
      metricIds: [...specification.metricIds],
      abilityTags: [...specification.abilityTags],
      skills: [...specification.skills],
      sourceCreatedAt: new Date(createdAt),
    };
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
