import { ConfigService } from '@nestjs/config';
import { ConsumerCrashEvent, EachMessagePayload } from 'kafkajs';

import { BENCHMARK_MESSAGE_TYPES } from '@/benchmark-service/contracts/benchmark-integration.v1';
import { ConsumerService } from '@/kafka/consumer.service';
import { IKafkaDeadLetterRepository } from '@/kafka/dead-letter.repository.interface';
import { KAFKA_TOPICS } from '@/kafka/kafka.constants';

import { BenchmarkSearchService } from '../search/benchmark-search.service';
import { CatalogBenchmarkEventsConsumer } from './catalog-benchmark-events.consumer';
import { CatalogBenchmarkProjectionService } from './catalog-benchmark-projection.service';

describe('CatalogBenchmarkEventsConsumer', () => {
  const aggregateId = '11111111-1111-4111-8111-111111111111';
  const event = {
    eventId: '22222222-2222-4222-8222-222222222222',
    eventType: BENCHMARK_MESSAGE_TYPES.suiteDeleted,
    eventVersion: 1,
    occurredAt: '2026-09-08T08:00:00.000Z',
    correlationId: '33333333-3333-4333-8333-333333333333',
    causationId: null,
    producer: 'benchmark-service',
    aggregateType: 'benchmark',
    aggregateId,
    aggregateVersion: 2,
    data: {
      benchmarkId: aggregateId,
      deletedAt: '2026-09-08T08:00:00.000Z',
    },
  } as const;

  const consume = jest.fn();
  const apply = jest.fn();
  const indexBenchmark = jest.fn();
  const reindexSuite = jest.fn();
  const recordFailure = jest.fn();
  const markResolved = jest.fn();

  const consumerService = { consume } as unknown as ConsumerService;
  const projection = { apply } as unknown as CatalogBenchmarkProjectionService;
  const search = {
    indexBenchmark,
    reindexSuite,
  } as unknown as BenchmarkSearchService;
  const deadLetterRepository = {
    recordFailure,
    markResolved,
  } as unknown as IKafkaDeadLetterRepository;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    consume.mockResolvedValue(undefined);
    apply.mockResolvedValue({ disposition: 'applied' });
    indexBenchmark.mockResolvedValue('indexed');
    reindexSuite.mockResolvedValue(0);
    markResolved.mockResolvedValue(undefined);
    recordFailure.mockResolvedValue({
      disposition: 'retry',
      attempts: 1,
      deadLetterEventId: null,
    });
  });

  afterEach(() => jest.useRealTimers());

  it('stays completely idle when Kafka is disabled', async () => {
    const service = createService(false);

    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(10_000);

    expect(consume).not.toHaveBeenCalled();
  });

  it('subscribes to Benchmark events without blocking application startup', async () => {
    const service = createService();

    service.onApplicationBootstrap();
    expect(consume).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(0);

    expect(consume).toHaveBeenCalledWith(
      {
        topics: [KAFKA_TOPICS.benchmarkEvents],
        fromBeginning: true,
      },
      { eachMessage: expect.any(Function) },
      { onCrash: expect.any(Function) }
    );
  });

  it('validates the envelope and key before applying the projection', async () => {
    const service = createService();
    const handler = await startAndGetHandler(service);
    const payload = kafkaPayload();

    await expect(handler(payload)).resolves.toBeUndefined();

    expect(apply).toHaveBeenCalledWith(event, {
      topic: KAFKA_TOPICS.benchmarkEvents,
      partition: 3,
      offset: '42',
    });
    expect(reindexSuite).toHaveBeenCalledWith(aggregateId);
    expect(markResolved).toHaveBeenCalledWith({
      topic: KAFKA_TOPICS.benchmarkEvents,
      partition: 3,
      offset: '42',
    });
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('does not mutate the projection when Kafka key and aggregate differ', async () => {
    const service = createService();
    const handler = await startAndGetHandler(service);

    await expect(handler(kafkaPayload({ key: Buffer.from('wrong-id') }))).rejects.toThrow(
      'Kafka message key must equal the Benchmark aggregateId'
    );

    expect(apply).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        maxAttempts: 5,
        deadLetter: {
          topic: KAFKA_TOPICS.benchmarkEventsDeadLetter,
          eventType: 'catalog.benchmark-event.dead-lettered.v1',
        },
      })
    );
  });

  it('rethrows a processing error while retry attempts remain', async () => {
    const service = createService();
    const handler = await startAndGetHandler(service);
    apply.mockRejectedValue(new Error('database unavailable'));

    await expect(handler(kafkaPayload())).rejects.toThrow('database unavailable');
    expect(markResolved).not.toHaveBeenCalled();
  });

  it('retries the Kafka event when search synchronization fails', async () => {
    const service = createService();
    const handler = await startAndGetHandler(service);
    reindexSuite.mockRejectedValue(new Error('embedding unavailable'));

    await expect(handler(kafkaPayload())).rejects.toThrow('embedding unavailable');

    expect(apply).toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalled();
    expect(markResolved).not.toHaveBeenCalled();
  });

  it('allows Kafka to commit only after the poison event is in DLQ Outbox', async () => {
    const service = createService();
    const handler = await startAndGetHandler(service);
    apply.mockRejectedValue(new Error('invalid projection event'));
    recordFailure.mockResolvedValue({
      disposition: 'dead_lettered',
      attempts: 5,
      deadLetterEventId: '44444444-4444-4444-8444-444444444444',
    });

    await expect(handler(kafkaPayload())).resolves.toBeUndefined();
    expect(markResolved).not.toHaveBeenCalled();
  });

  it('retries an initial broker connection failure after the configured delay', async () => {
    consume.mockRejectedValueOnce(new Error('broker unavailable')).mockResolvedValueOnce(undefined);
    const service = createService();

    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(consume).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(4_999);
    expect(consume).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(consume).toHaveBeenCalledTimes(2);
  });

  it('restarts after a terminal KafkaJS crash but not during shutdown', async () => {
    const service = createService();
    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);

    const lifecycle = consume.mock.calls[0][2] as {
      onCrash: (event: ConsumerCrashEvent) => void;
    };
    lifecycle.onCrash({
      id: '1',
      type: 'consumer.crash',
      timestamp: 1,
      payload: {
        error: new Error('consumer stopped'),
        groupId: 'catalog',
        restart: false,
      },
    });
    await jest.advanceTimersByTimeAsync(5_000);
    expect(consume).toHaveBeenCalledTimes(2);

    service.beforeApplicationShutdown();
    lifecycle.onCrash({
      id: '2',
      type: 'consumer.crash',
      timestamp: 2,
      payload: {
        error: new Error('shutdown'),
        groupId: 'catalog',
        restart: false,
      },
    });
    await jest.advanceTimersByTimeAsync(5_000);
    expect(consume).toHaveBeenCalledTimes(2);
  });

  function createService(enabled = true): CatalogBenchmarkEventsConsumer {
    return new CatalogBenchmarkEventsConsumer(
      consumerService,
      projection,
      search,
      deadLetterRepository,
      {
        getOrThrow: jest.fn().mockReturnValue({
          enabled,
          consumerRestartDelayMs: 5_000,
          consumerMaxProcessingAttempts: 5,
        }),
      } as unknown as ConfigService
    );
  }

  async function startAndGetHandler(
    service: CatalogBenchmarkEventsConsumer
  ): Promise<(payload: EachMessagePayload) => Promise<void>> {
    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    const config = consume.mock.calls[0][1] as {
      eachMessage: (payload: EachMessagePayload) => Promise<void>;
    };
    return config.eachMessage;
  }

  function kafkaPayload(
    messageOverrides: Readonly<{
      key?: Buffer | null;
      value?: Buffer | null;
      offset?: string;
    }> = {}
  ): EachMessagePayload {
    return {
      topic: KAFKA_TOPICS.benchmarkEvents,
      partition: 3,
      message: {
        key: Buffer.from(aggregateId),
        value: Buffer.from(JSON.stringify(event)),
        timestamp: '0',
        attributes: 0,
        offset: '42',
        headers: { trace: Buffer.from('abc') },
        ...messageOverrides,
      },
      heartbeat: jest.fn(),
      pause: jest.fn(),
    };
  }
});
