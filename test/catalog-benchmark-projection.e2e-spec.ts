import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import {
  BENCHMARK_MESSAGE_TYPES,
  BenchmarkIntegrationMessageV1,
  parseBenchmarkIntegrationMessageV1,
} from '@/benchmark-service/contracts/benchmark-integration.v1';
import { CatalogBenchmarkProjectionService } from '@/catalog/projection/catalog-benchmark-projection.service';
import { KAFKA_TOPICS } from '@/kafka/kafka.constants';
import { PrismaService } from '@/prisma/prisma.service';
import { createE2eApplication } from './support/create-e2e-application';

describe('Catalog Benchmark projection Inbox (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let projection: CatalogBenchmarkProjectionService;

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
    projection = app.get(CatalogBenchmarkProjectionService);
  });

  beforeEach(async () => {
    await clearFixtures();
  });

  afterAll(async () => {
    await clearFixtures();
    await app.close();
  });

  async function clearFixtures(): Promise<void> {
    await prisma.metricUploadRow.deleteMany();
    await prisma.metricResult.deleteMany();
    await prisma.inboxMessage.deleteMany({
      where: { topic: KAFKA_TOPICS.benchmarkEvents },
    });
    await prisma.catalogTestProjection.deleteMany();
    await prisma.catalogBenchmarkProjection.deleteMany();
    await prisma.benchmarkCommandOutcome.deleteMany();
    await prisma.outboxMessage.deleteMany({
      where: {
        topic: {
          in: [KAFKA_TOPICS.benchmarkEvents, KAFKA_TOPICS.benchmarkCommands],
        },
      },
    });
    await prisma.catalogEntry.deleteMany();
    await prisma.metricDefinition.deleteMany();
  }

  function metadata(offset: number) {
    return {
      topic: KAFKA_TOPICS.benchmarkEvents,
      partition: 0,
      offset: String(offset),
    };
  }

  function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  function withIdentity<T extends Record<string, unknown>>(
    value: T
  ): T {
    return {
      ...value,
      eventId: randomUUID(),
      correlationId: randomUUID(),
    };
  }

  it('applies snapshots and ignores duplicate and stale deliveries', async () => {
    const benchmarkId = randomUUID();
    const testId = randomUUID();
    const suiteEvent = suiteSnapshotEvent(benchmarkId);
    const testEvent = testSnapshotEvent(testId, benchmarkId);

    await expect(projection.apply(suiteEvent, metadata(0))).resolves.toMatchObject({
      disposition: 'applied',
      aggregateId: benchmarkId,
      aggregateVersion: 1,
    });
    await expect(projection.apply(testEvent, metadata(1))).resolves.toMatchObject({
      disposition: 'applied',
      aggregateId: testId,
      aggregateVersion: 1,
    });
    await expect(projection.apply(testEvent, metadata(2))).resolves.toMatchObject({
      disposition: 'duplicate',
    });

    const projectedTest = await prisma.catalogTestProjection.findUniqueOrThrow({
      where: { testId },
    });
    expect(projectedTest).toMatchObject({
      benchmarkId,
      aggregateVersion: 1,
      deletedAt: null,
    });
    expect(projectedTest.snapshot).toMatchObject({
      specification: { name: 'Projected Test' },
    });
    await expect(
      prisma.catalogBenchmarkProjection.findUniqueOrThrow({
        where: { benchmarkId },
        select: { sourceCreatedAt: true },
      })
    ).resolves.toEqual({ sourceCreatedAt: expect.any(Date) });
    await expect(prisma.inboxMessage.count({
      where: { topic: KAFKA_TOPICS.benchmarkEvents },
    })).resolves.toBe(2);

    const version3 = withIdentity(clone(testEvent) as any);
    version3.aggregateVersion = 3;
    version3.data.test.aggregateVersion = 3;
    version3.data.test.specification.name = 'Projected Test v3';
    await expect(projection.apply(version3, metadata(2))).resolves.toMatchObject({
      disposition: 'applied',
      aggregateVersion: 3,
    });

    const delayedVersion2 = withIdentity(clone(version3));
    delayedVersion2.aggregateVersion = 2;
    delayedVersion2.data.test.aggregateVersion = 2;
    delayedVersion2.data.test.specification.name = 'Stale Test v2';
    await expect(
      projection.apply(delayedVersion2, metadata(3))
    ).resolves.toMatchObject({ disposition: 'stale' });

    const finalProjection = await prisma.catalogTestProjection.findUniqueOrThrow({
      where: { testId },
    });
    expect(finalProjection.aggregateVersion).toBe(3);
    expect(finalProjection.snapshot).toMatchObject({
      specification: { name: 'Projected Test v3' },
    });
  });

  it('rolls back when a Kafka position belongs to another eventId', async () => {
    const benchmarkId = randomUUID();
    const original = {
      eventId: randomUUID(),
      eventType: BENCHMARK_MESSAGE_TYPES.suiteSnapshot,
      eventVersion: 1,
      occurredAt: '2026-09-08T00:00:00.000Z',
      correlationId: randomUUID(),
      causationId: null,
      producer: 'benchmark-service',
      aggregateType: 'benchmark',
      aggregateId: benchmarkId,
      aggregateVersion: 1,
      data: {
        benchmark: {
          id: benchmarkId,
          aggregateVersion: 1,
          name: 'Original',
          nameEn: 'Original EN',
          createdAt: '2026-09-08T00:00:00.000Z',
          updatedAt: '2026-09-08T00:00:00.000Z',
          deletedAt: null,
        },
      },
    };
    await projection.apply(original, metadata(10));

    const conflicting = withIdentity(clone(original) as any);
    conflicting.aggregateVersion = 2;
    conflicting.data.benchmark.aggregateVersion = 2;
    conflicting.data.benchmark.name = 'Must not be applied';

    await expect(projection.apply(conflicting, metadata(10))).rejects.toThrow(
      /Kafka position was already processed/
    );
    await expect(
      prisma.catalogBenchmarkProjection.findUniqueOrThrow({
        where: { benchmarkId },
        select: { name: true, aggregateVersion: true },
      })
    ).resolves.toEqual({ name: 'Original', aggregateVersion: 1 });
    await expect(prisma.inboxMessage.findUnique({
      where: { id: conflicting.eventId },
    })).resolves.toBeNull();
  });

  it('stores tombstones received before snapshots and rejects commands', async () => {
    const benchmarkId = randomUUID();
    const tombstone = {
      eventId: randomUUID(),
      eventType: BENCHMARK_MESSAGE_TYPES.suiteDeleted,
      eventVersion: 1,
      occurredAt: '2026-09-08T00:00:00.000Z',
      correlationId: randomUUID(),
      causationId: null,
      producer: 'benchmark-service',
      aggregateType: 'benchmark',
      aggregateId: benchmarkId,
      aggregateVersion: 5,
      data: {
        benchmarkId,
        deletedAt: '2026-09-08T00:00:00.000Z',
      },
    };

    await expect(projection.apply(tombstone, metadata(20))).resolves.toMatchObject({
      disposition: 'applied',
      aggregateVersion: 5,
    });
    await expect(
      prisma.catalogBenchmarkProjection.findUniqueOrThrow({
        where: { benchmarkId },
      })
    ).resolves.toMatchObject({
      name: null,
      nameEn: null,
      aggregateVersion: 5,
      deletedAt: new Date('2026-09-08T00:00:00.000Z'),
    });

    const command = {
      ...tombstone,
      eventId: randomUUID(),
      eventType: BENCHMARK_MESSAGE_TYPES.testDeleteRequested,
      producer: 'benchmark-catalog',
      aggregateType: 'test',
      aggregateId: randomUUID(),
      aggregateVersion: 1,
      data: {
        testId: '',
        expectedAggregateVersion: 1,
      },
    };
    command.data.testId = command.aggregateId;

    await expect(projection.apply(command, metadata(21))).rejects.toThrow(
      /Catalog projection cannot consume/
    );
    await expect(prisma.inboxMessage.findUnique({
      where: { id: command.eventId },
    })).resolves.toBeNull();
  });

  it('records a business rejection against its command and acknowledges it', async () => {
    const benchmarkId = randomUUID();
    const commandEventId = randomUUID();
    await prisma.outboxMessage.create({
      data: {
        id: commandEventId,
        topic: KAFKA_TOPICS.benchmarkCommands,
        messageKey: benchmarkId,
        eventType: BENCHMARK_MESSAGE_TYPES.suiteCreateRequested,
        aggregateType: 'benchmark',
        aggregateId: benchmarkId,
        deduplicationKey: `test-command:${commandEventId}`,
        payload: {
          eventId: commandEventId,
          eventType: BENCHMARK_MESSAGE_TYPES.suiteCreateRequested,
        },
        publishedAt: new Date(),
      },
    });

    const rejection = {
      eventId: randomUUID(),
      eventType: BENCHMARK_MESSAGE_TYPES.commandRejected,
      eventVersion: 1,
      occurredAt: '2026-09-09T12:00:00.000Z',
      correlationId: randomUUID(),
      causationId: commandEventId,
      producer: 'benchmark-service',
      aggregateType: 'benchmark',
      aggregateId: benchmarkId,
      aggregateVersion: 1,
      data: {
        commandEventId,
        reasonCode: 'SOFT_DELETED_ENTITY_EXISTS',
        statusCode: 409,
        deletedId: benchmarkId,
        message: 'Benchmark was previously deleted',
      },
    };

    await expect(projection.apply(rejection, metadata(30))).resolves.toMatchObject({
      disposition: 'applied',
      eventId: rejection.eventId,
      aggregateId: benchmarkId,
    });
    await expect(
      prisma.benchmarkCommandOutcome.findUniqueOrThrow({
        where: { commandEventId },
      })
    ).resolves.toMatchObject({
      responseEventId: rejection.eventId,
      commandEventType: BENCHMARK_MESSAGE_TYPES.suiteCreateRequested,
      aggregateType: 'benchmark',
      aggregateId: benchmarkId,
      status: 'rejected',
      reasonCode: 'SOFT_DELETED_ENTITY_EXISTS',
      statusCode: 409,
      deletedId: benchmarkId,
      message: 'Benchmark was previously deleted',
      occurredAt: new Date(rejection.occurredAt),
    });
    await expect(
      prisma.outboxMessage.findUniqueOrThrow({
        where: { id: commandEventId },
        select: { lastError: true },
      })
    ).resolves.toEqual({ lastError: null });
    await expect(
      prisma.inboxMessage.findUnique({ where: { id: rejection.eventId } })
    ).resolves.toMatchObject({
      eventType: BENCHMARK_MESSAGE_TYPES.commandRejected,
      aggregateType: 'benchmark',
      aggregateId: benchmarkId,
    });

    await expect(projection.apply(rejection, metadata(31))).resolves.toMatchObject({
      disposition: 'duplicate',
    });
  });

  it('acknowledges a rejection from another Catalog instance', async () => {
    const benchmarkId = randomUUID();
    const unknownCommandEventId = randomUUID();
    const rejection = {
      eventId: randomUUID(),
      eventType: BENCHMARK_MESSAGE_TYPES.commandRejected,
      eventVersion: 1,
      occurredAt: '2026-09-09T12:00:00.000Z',
      correlationId: randomUUID(),
      causationId: unknownCommandEventId,
      producer: 'benchmark-service',
      aggregateType: 'benchmark',
      aggregateId: benchmarkId,
      aggregateVersion: 1,
      data: {
        commandEventId: unknownCommandEventId,
        reasonCode: 'BENCHMARK_NOT_FOUND',
        message: 'Benchmark was not found',
      },
    };

    await expect(projection.apply(rejection, metadata(40))).resolves.toMatchObject({
      disposition: 'applied',
      eventId: rejection.eventId,
    });
    await expect(
      prisma.inboxMessage.findUnique({ where: { id: rejection.eventId } })
    ).resolves.toMatchObject({
      eventType: BENCHMARK_MESSAGE_TYPES.commandRejected,
      aggregateId: benchmarkId,
    });
    await expect(
      prisma.benchmarkCommandOutcome.findUnique({
        where: { commandEventId: unknownCommandEventId },
      })
    ).resolves.toBeNull();
  });

  it('rebuilds a snapshot caused by a command absent from this Catalog', async () => {
    const benchmarkId = randomUUID();
    const foreignCommandEventId = randomUUID();
    const snapshot = {
      eventId: randomUUID(),
      eventType: BENCHMARK_MESSAGE_TYPES.suiteSnapshot,
      eventVersion: 1,
      occurredAt: '2026-09-09T12:30:00.000Z',
      correlationId: randomUUID(),
      causationId: foreignCommandEventId,
      producer: 'benchmark-service',
      aggregateType: 'benchmark',
      aggregateId: benchmarkId,
      aggregateVersion: 1,
      data: {
        benchmark: {
          id: benchmarkId,
          aggregateVersion: 1,
          name: 'Foreign Suite',
          nameEn: 'Foreign Suite EN',
          createdAt: '2026-09-09T12:00:00.000Z',
          updatedAt: '2026-09-09T12:30:00.000Z',
          deletedAt: null,
        },
      },
    };

    await expect(projection.apply(snapshot, metadata(41))).resolves.toMatchObject({
      disposition: 'applied',
      aggregateId: benchmarkId,
    });
    await expect(
      prisma.catalogBenchmarkProjection.findUniqueOrThrow({
        where: { benchmarkId },
      })
    ).resolves.toMatchObject({
      name: 'Foreign Suite',
      aggregateVersion: 1,
    });
    await expect(
      prisma.benchmarkCommandOutcome.findUnique({
        where: { commandEventId: foreignCommandEventId },
      })
    ).resolves.toBeNull();
  });

  it('records an applied command from the snapshot causation id', async () => {
    const benchmarkId = randomUUID();
    const commandEventId = randomUUID();
    await prisma.outboxMessage.create({
      data: {
        id: commandEventId,
        topic: KAFKA_TOPICS.benchmarkCommands,
        messageKey: benchmarkId,
        eventType: BENCHMARK_MESSAGE_TYPES.suiteUpdateRequested,
        aggregateType: 'benchmark',
        aggregateId: benchmarkId,
        deduplicationKey: `test-command:${commandEventId}`,
        payload: { eventId: commandEventId },
        publishedAt: new Date(),
      },
    });
    const snapshot = {
      eventId: randomUUID(),
      eventType: BENCHMARK_MESSAGE_TYPES.suiteSnapshot,
      eventVersion: 1,
      occurredAt: '2026-09-09T13:00:00.000Z',
      correlationId: randomUUID(),
      causationId: commandEventId,
      producer: 'benchmark-service',
      aggregateType: 'benchmark',
      aggregateId: benchmarkId,
      aggregateVersion: 2,
      data: {
        benchmark: {
          id: benchmarkId,
          aggregateVersion: 2,
          name: 'Applied Suite',
          nameEn: 'Applied Suite EN',
          createdAt: '2026-09-09T10:00:00.000Z',
          updatedAt: '2026-09-09T13:00:00.000Z',
          deletedAt: null,
        },
      },
    };

    await expect(projection.apply(snapshot, metadata(50))).resolves.toMatchObject({
      disposition: 'applied',
    });
    await expect(
      prisma.benchmarkCommandOutcome.findUniqueOrThrow({
        where: { commandEventId },
      })
    ).resolves.toMatchObject({
      responseEventId: snapshot.eventId,
      status: 'applied',
      reasonCode: null,
      message: null,
    });

    const idempotentCommandEventId = randomUUID();
    await prisma.outboxMessage.create({
      data: {
        id: idempotentCommandEventId,
        topic: KAFKA_TOPICS.benchmarkCommands,
        messageKey: benchmarkId,
        eventType: BENCHMARK_MESSAGE_TYPES.suiteRestoreRequested,
        aggregateType: 'benchmark',
        aggregateId: benchmarkId,
        deduplicationKey: `test-command:${idempotentCommandEventId}`,
        payload: { eventId: idempotentCommandEventId },
        publishedAt: new Date(),
      },
    });
    const sameVersionResponse = {
      ...snapshot,
      eventId: randomUUID(),
      correlationId: randomUUID(),
      causationId: idempotentCommandEventId,
    };

    await expect(
      projection.apply(sameVersionResponse, metadata(51))
    ).resolves.toMatchObject({ disposition: 'stale' });
    await expect(
      prisma.benchmarkCommandOutcome.findUniqueOrThrow({
        where: { commandEventId: idempotentCommandEventId },
      })
    ).resolves.toMatchObject({
      responseEventId: sameVersionResponse.eventId,
      status: 'applied',
    });
  });
});

function suiteSnapshotEvent(benchmarkId: string): BenchmarkIntegrationMessageV1 {
  return parseBenchmarkIntegrationMessageV1({
    eventId: randomUUID(),
    eventType: BENCHMARK_MESSAGE_TYPES.suiteSnapshot,
    eventVersion: 1,
    occurredAt: '2026-09-08T00:00:00.000Z',
    correlationId: randomUUID(),
    causationId: null,
    producer: 'benchmark-service',
    aggregateType: 'benchmark',
    aggregateId: benchmarkId,
    aggregateVersion: 1,
    data: {
      benchmark: {
        id: benchmarkId,
        aggregateVersion: 1,
        name: 'Projected Suite',
        nameEn: 'Projected Suite EN',
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
        deletedAt: null,
      },
    },
  });
}

function testSnapshotEvent(
  testId: string,
  benchmarkId: string
): BenchmarkIntegrationMessageV1 {
  return parseBenchmarkIntegrationMessageV1({
    eventId: randomUUID(),
    eventType: BENCHMARK_MESSAGE_TYPES.testSnapshot,
    eventVersion: 1,
    occurredAt: '2026-09-08T00:00:00.000Z',
    correlationId: randomUUID(),
    causationId: null,
    producer: 'benchmark-service',
    aggregateType: 'test',
    aggregateId: testId,
    aggregateVersion: 1,
    data: {
      test: {
        id: testId,
        aggregateVersion: 1,
        specification: {
          suiteId: benchmarkId,
          name: 'Projected Test',
          nameEn: 'Projected Test EN',
          description: 'Projection snapshot',
          subGroupIds: [],
          abilityTaxonIds: [],
          modalityIds: [],
          capabilityIds: [],
          domainIds: [],
          subdomainIds: [],
          abilityTags: [],
          skills: [],
          metricIds: [],
          examples: [],
          datasetSubsamples: [],
          references: [],
          links: [],
          sizeInSamples: 0,
          medianSampleSizeWords: 0,
          requestLengthDist: { min: 0, median: 0, max: 0 },
          responseLengthDist: { min: 0, median: 0, max: 0 },
          isDifficultyAutoCalculated: false,
          isGenerated: false,
        },
        specificationLockedAt: null,
        specificationLockReason: null,
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
        deletedAt: null,
      },
    },
  });
}
