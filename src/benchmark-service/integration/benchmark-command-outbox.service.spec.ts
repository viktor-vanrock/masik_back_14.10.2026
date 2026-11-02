import { ConflictException } from '@nestjs/common';
import {
  BENCHMARK_MESSAGE_TYPES,
  parseBenchmarkIntegrationMessageV1,
} from '@/benchmark-service/contracts/benchmark-integration.v1';
import { Prisma } from '@/generated/prisma/client';
import { KAFKA_TOPICS } from '@/kafka/kafka.constants';
import { BenchmarkCommandOutboxService } from './benchmark-command-outbox.service';

const IDS = {
  suite: '11111111-1111-4111-8111-111111111111',
  test: '22222222-2222-4222-8222-222222222222',
  result: '44444444-4444-4444-8444-444444444444',
};

describe('BenchmarkCommandOutboxService', () => {
  const upsert = jest.fn(async (args: {
    create: { id: string; payload: unknown };
  }) => ({ id: args.create.id, payload: args.create.payload }));
  const update = jest.fn();
  const findOutcome = jest.fn();
  const tx = {
    outboxMessage: { upsert, update },
    benchmarkCommandOutcome: { findUnique: findOutcome },
  } as unknown as Prisma.TransactionClient;
  const service = new BenchmarkCommandOutboxService();

  beforeEach(() => {
    jest.clearAllMocks();
    findOutcome.mockResolvedValue(null);
  });

  it('atomically queues a versioned command for the Benchmark service', async () => {
    await expect(
      service.requestSuiteUpdate(tx, IDS.suite, 4, {
        name: 'Группа',
        nameEn: 'Suite',
        description: null,
        descriptionEn: null,
      })
    ).resolves.toEqual(expect.any(String));

    const call = upsert.mock.calls[0][0];
    expect(call.create).toMatchObject({
      topic: KAFKA_TOPICS.benchmarkCommands,
      messageKey: IDS.suite,
      eventType: BENCHMARK_MESSAGE_TYPES.suiteUpdateRequested,
      aggregateType: 'benchmark',
      aggregateId: IDS.suite,
    });
    expect(parseBenchmarkIntegrationMessageV1(call.create.payload)).toMatchObject({
      aggregateVersion: 4,
      data: { benchmarkId: IDS.suite, expectedAggregateVersion: 4 },
    });
  });

  it('returns the existing operation for an identical deduplicated command', async () => {
    upsert.mockImplementationOnce(async (args) => ({
      id: 'existing-operation',
      payload: args.create.payload,
    }));

    await expect(
      service.requestSuiteCreate(tx, IDS.suite, {
        name: 'Группа',
        nameEn: 'Suite',
        description: null,
        descriptionEn: null,
      })
    ).resolves.toBe('existing-operation');
  });

  it('rejects a different operation occupying the same aggregate version', async () => {
    upsert.mockImplementationOnce(async (args) => ({
      id: 'existing-operation',
      payload: {
        ...(args.create.payload as object),
        data: {
          benchmarkId: IDS.suite,
          expectedAggregateVersion: 4,
          specification: {
            name: 'Different',
            nameEn: 'Different',
            description: null,
            descriptionEn: null,
          },
        },
      },
    }));

    await expect(
      service.requestSuiteUpdate(tx, IDS.suite, 4, {
        name: 'Группа',
        nameEn: 'Suite',
        description: null,
        descriptionEn: null,
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('deduplicates a specification lock by its MetricResult source event', async () => {
    await service.testSpecificationLocked(
      tx,
      { id: IDS.test, aggregateVersion: 7 },
      IDS.result
    );

    expect(upsert.mock.calls[0][0]).toMatchObject({
      where: {
        deduplicationKey:
          `command:${BENCHMARK_MESSAGE_TYPES.testSpecificationLockRequested}:` +
          `${IDS.test}:${IDS.result}`,
      },
      create: {
        topic: KAFKA_TOPICS.benchmarkCommands,
        messageKey: IDS.test,
      },
    });
  });

  it('keeps rejected command history and queues a new attempt at the same version', async () => {
    upsert.mockImplementationOnce(async (args) => ({
      id: 'rejected-operation',
      payload: args.create.payload,
    }));
    findOutcome.mockResolvedValueOnce({ status: 'rejected' });

    const operationId = await service.requestSuiteDelete(tx, IDS.suite, 4);

    expect(operationId).not.toBe('rejected-operation');
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'rejected-operation' },
      data: {
        deduplicationKey:
          `command:${BENCHMARK_MESSAGE_TYPES.suiteDeleteRequested}:` +
          `${IDS.suite}:4:rejected:rejected-operation`,
      },
    });
  });
});
