import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ConflictException, Injectable } from '@nestjs/common';
import {
  BENCHMARK_MESSAGE_TYPES,
  BenchmarkIntegrationMessageV1,
  BenchmarkSuiteCreateRequestedV1,
  BenchmarkSuiteLifecycleRequestedV1,
  BenchmarkSuiteUpdateRequestedV1,
  BenchmarkTestCreateRequestedV1,
  BenchmarkTestLifecycleRequestedV1,
  BenchmarkTestSpecificationLockRequestedV1,
  BenchmarkTestSpecificationV1,
  BenchmarkTestUpdateRequestedV1,
  parseBenchmarkIntegrationMessageV1,
} from '@/benchmark-service/contracts/benchmark-integration.v1';
import { Prisma } from '@/generated/prisma/client';
import { KAFKA_TOPICS } from '@/kafka/kafka.constants';

export function pendingTestReferences(field: keyof Pick<BenchmarkTestSpecificationV1,
  'metricIds' | 'macroGroupId' | 'taskTypeId' | 'languageId' | 'difficultyId' |
  'subGroupIds' | 'abilityTaxonIds' | 'domainIds' | 'subdomainIds' | 'modalityIds' | 'capabilityIds'
>): Prisma.Sql {
  const value = Prisma.sql`command.payload -> 'data' -> 'specification' -> ${field}::TEXT`;
  return Prisma.sql`
    SELECT DISTINCT command.aggregate_id::UUID::TEXT AS test_id, used.id::UUID::TEXT AS id
    FROM outbox_messages command
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(${value}) = 'array'
        THEN ${value} ELSE jsonb_build_array(${value}) END
    ) AS used(id)
    WHERE command.topic = ${KAFKA_TOPICS.benchmarkCommands}
      AND command.event_type IN (
        ${BENCHMARK_MESSAGE_TYPES.testCreateRequested},
        ${BENCHMARK_MESSAGE_TYPES.testUpdateRequested}
      )
      AND NOT EXISTS (
        SELECT 1 FROM benchmark_command_outcomes outcome
        WHERE outcome.command_event_id = command.id
      )
  `;
}

@Injectable()
export class BenchmarkCommandOutboxService {
  async lockTestWrites(tx: Prisma.TransactionClient, testId: string): Promise<void> {
    await tx.$queryRaw`
      SELECT true AS acquired
      FROM pg_advisory_xact_lock(hashtextextended(${'metric-result:' + testId.toLowerCase()}, 0))
    `;
  }

  async assertNoPendingTestMutation(
    tx: Prisma.TransactionClient,
    testId: string
  ): Promise<void> {
    const pending = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT command.id
      FROM outbox_messages command
      WHERE command.topic = ${KAFKA_TOPICS.benchmarkCommands}
        AND command.aggregate_id = ${testId.toLowerCase()}
        AND command.event_type IN (
          ${BENCHMARK_MESSAGE_TYPES.testUpdateRequested},
          ${BENCHMARK_MESSAGE_TYPES.testDeleteRequested}
        )
        AND NOT EXISTS (
          SELECT 1 FROM benchmark_command_outcomes outcome
          WHERE outcome.command_event_id = command.id
        )
      LIMIT 1
    `;
    if (pending.length > 0) {
      throw new ConflictException(
        `Wait for the pending Test operation to complete: "${testId}"`
      );
    }
  }

  requestSuiteCreate(
    tx: Prisma.TransactionClient,
    benchmarkId: string,
    specification: BenchmarkSuiteCreateRequestedV1['data']['specification']
  ): Promise<string> {
    const eventId = randomUUID();
    return this.enqueueRequired(tx, {
      ...this.envelope(
        eventId,
        BENCHMARK_MESSAGE_TYPES.suiteCreateRequested,
        'benchmark',
        benchmarkId,
        1
      ),
      data: {
        benchmarkId,
        specification,
      },
    } satisfies BenchmarkSuiteCreateRequestedV1);
  }

  requestSuiteUpdate(
    tx: Prisma.TransactionClient,
    benchmarkId: string,
    expectedAggregateVersion: number,
    specification: BenchmarkSuiteUpdateRequestedV1['data']['specification']
  ): Promise<string> {
    const eventId = randomUUID();
    return this.enqueueRequired(tx, {
      ...this.envelope(
        eventId,
        BENCHMARK_MESSAGE_TYPES.suiteUpdateRequested,
        'benchmark',
        benchmarkId,
        expectedAggregateVersion
      ),
      data: {
        benchmarkId,
        expectedAggregateVersion,
        specification,
      },
    } satisfies BenchmarkSuiteUpdateRequestedV1);
  }

  requestSuiteDelete(
    tx: Prisma.TransactionClient,
    benchmarkId: string,
    expectedAggregateVersion: number
  ): Promise<string> {
    return this.requestSuiteLifecycle(
      tx,
      BENCHMARK_MESSAGE_TYPES.suiteDeleteRequested,
      benchmarkId,
      expectedAggregateVersion
    );
  }

  requestSuiteRestore(
    tx: Prisma.TransactionClient,
    benchmarkId: string,
    expectedAggregateVersion: number
  ): Promise<string> {
    return this.requestSuiteLifecycle(
      tx,
      BENCHMARK_MESSAGE_TYPES.suiteRestoreRequested,
      benchmarkId,
      expectedAggregateVersion
    );
  }

  requestTestCreate(
    tx: Prisma.TransactionClient,
    testId: string,
    specification: BenchmarkTestCreateRequestedV1['data']['specification']
  ): Promise<string> {
    const eventId = randomUUID();
    return this.enqueueRequired(tx, {
      ...this.envelope(
        eventId,
        BENCHMARK_MESSAGE_TYPES.testCreateRequested,
        'test',
        testId,
        1
      ),
      data: { testId, specification },
    } satisfies BenchmarkTestCreateRequestedV1);
  }

  requestTestUpdate(
    tx: Prisma.TransactionClient,
    testId: string,
    expectedAggregateVersion: number,
    specification: BenchmarkTestUpdateRequestedV1['data']['specification']
  ): Promise<string> {
    const eventId = randomUUID();
    return this.enqueueRequired(tx, {
      ...this.envelope(
        eventId,
        BENCHMARK_MESSAGE_TYPES.testUpdateRequested,
        'test',
        testId,
        expectedAggregateVersion
      ),
      data: {
        testId,
        expectedAggregateVersion,
        specification,
      },
    } satisfies BenchmarkTestUpdateRequestedV1);
  }

  requestTestDelete(
    tx: Prisma.TransactionClient,
    testId: string,
    expectedAggregateVersion: number
  ): Promise<string> {
    return this.requestTestLifecycle(
      tx,
      BENCHMARK_MESSAGE_TYPES.testDeleteRequested,
      testId,
      expectedAggregateVersion
    );
  }

  requestTestRestore(
    tx: Prisma.TransactionClient,
    testId: string,
    expectedAggregateVersion: number
  ): Promise<string> {
    return this.requestTestLifecycle(
      tx,
      BENCHMARK_MESSAGE_TYPES.testRestoreRequested,
      testId,
      expectedAggregateVersion
    );
  }

  testSpecificationLocked(
    tx: Prisma.TransactionClient,
    test: { id: string; aggregateVersion: number },
    sourceEventId: string
  ): Promise<void> {
    const eventId = randomUUID();
    return this.enqueue(tx, {
      ...this.envelope(
        eventId,
        BENCHMARK_MESSAGE_TYPES.testSpecificationLockRequested,
        'test',
        test.id,
        test.aggregateVersion
      ),
      data: {
        testId: test.id,
        sourceEventId,
        reason: 'metric_result_created',
      },
    } satisfies BenchmarkTestSpecificationLockRequestedV1, sourceEventId).then(
      () => undefined
    );
  }

  private requestSuiteLifecycle(
    tx: Prisma.TransactionClient,
    eventType:
      | typeof BENCHMARK_MESSAGE_TYPES.suiteDeleteRequested
      | typeof BENCHMARK_MESSAGE_TYPES.suiteRestoreRequested,
    benchmarkId: string,
    expectedAggregateVersion: number
  ): Promise<string> {
    const eventId = randomUUID();
    return this.enqueueRequired(tx, {
      ...this.envelope(
        eventId,
        eventType,
        'benchmark',
        benchmarkId,
        expectedAggregateVersion
      ),
      data: { benchmarkId, expectedAggregateVersion },
    } satisfies BenchmarkSuiteLifecycleRequestedV1);
  }

  private requestTestLifecycle(
    tx: Prisma.TransactionClient,
    eventType:
      | typeof BENCHMARK_MESSAGE_TYPES.testDeleteRequested
      | typeof BENCHMARK_MESSAGE_TYPES.testRestoreRequested,
    testId: string,
    expectedAggregateVersion: number
  ): Promise<string> {
    const eventId = randomUUID();
    return this.enqueueRequired(tx, {
      ...this.envelope(
        eventId,
        eventType,
        'test',
        testId,
        expectedAggregateVersion
      ),
      data: { testId, expectedAggregateVersion },
    } satisfies BenchmarkTestLifecycleRequestedV1);
  }

  private envelope<
    T extends BenchmarkIntegrationMessageV1['eventType'],
    TAggregate extends 'benchmark' | 'test'
  >(
    eventId: string,
    eventType: T,
    aggregateType: TAggregate,
    aggregateId: string,
    aggregateVersion: number
  ) {
    return {
      eventId,
      eventType,
      eventVersion: 1 as const,
      occurredAt: new Date().toISOString(),
      correlationId: eventId,
      causationId: null,
      producer: 'benchmark-catalog' as const,
      aggregateType,
      aggregateId,
      aggregateVersion,
    };
  }

  private async enqueue(
    tx: Prisma.TransactionClient,
    event: BenchmarkIntegrationMessageV1,
    sourceEventId?: string
  ): Promise<string> {
    const message = parseBenchmarkIntegrationMessageV1(event);
    const version =
      sourceEventId ?? String(message.aggregateVersion);
    const deduplicationKey =
      `command:${message.eventType}:${message.aggregateId}:${version}`;
    const stored = await tx.outboxMessage.upsert({
      where: { deduplicationKey },
      create: {
        id: message.eventId,
        topic: KAFKA_TOPICS.benchmarkCommands,
        messageKey: message.aggregateId,
        eventType: message.eventType,
        aggregateType: message.aggregateType,
        aggregateId: message.aggregateId,
        deduplicationKey,
        payload: JSON.parse(JSON.stringify(message)) as Prisma.InputJsonValue,
      },
      update: {},
      select: { id: true, payload: true },
    });
    if (stored.id !== message.eventId) {
      const outcome = await tx.benchmarkCommandOutcome.findUnique({
        where: { commandEventId: stored.id },
        select: { status: true },
      });
      if ('rejected' === outcome?.status) {
        // A rejected command did not advance the source aggregate version.
        // Keep its history, but release the key so a corrected request can run.
        await tx.outboxMessage.update({
          where: { id: stored.id },
          data: { deduplicationKey: `${deduplicationKey}:rejected:${stored.id}` },
        });
        return this.enqueue(tx, event, sourceEventId);
      }
      const existing = parseBenchmarkIntegrationMessageV1(stored.payload);
      const requestedData = JSON.parse(
        JSON.stringify(message.data)
      ) as BenchmarkIntegrationMessageV1['data'];
      if (
        existing.eventType !== message.eventType ||
        !isDeepStrictEqual(existing.data, requestedData)
      ) {
        throw new ConflictException(
          `Another Benchmark operation is already queued for aggregate "${message.aggregateId}" at version ${message.aggregateVersion}`
        );
      }
    }
    return stored.id;
  }

  private enqueueRequired(
    tx: Prisma.TransactionClient,
    event: BenchmarkIntegrationMessageV1
  ): Promise<string> {
    return this.enqueue(tx, event);
  }
}
