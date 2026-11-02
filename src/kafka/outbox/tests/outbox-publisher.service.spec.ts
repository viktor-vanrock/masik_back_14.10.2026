import { ConfigService } from '@nestjs/config';
import { OutboxMessage } from '@/generated/prisma/client';
import { ProducerService } from '@/kafka/producer.service';
import { OutboxPublisherService } from '../outbox-publisher.service';
import { IOutboxRepository } from '../outbox.repository.interface';

describe('OutboxPublisherService', () => {
  const findPending = jest.fn();
  const markPublished = jest.fn();
  const markFailed = jest.fn();
  const produce = jest.fn();

  const repository = {
    findPending,
    markPublished,
    markFailed,
  } as unknown as IOutboxRepository;

  const producer = {
    produce,
  } as unknown as ProducerService;

  const now = new Date('2026-08-12T20:00:00.000Z');

  const message: OutboxMessage = {
    id: '11111111-1111-4111-8111-111111111111',
    topic: 'catalogue.recommendation.rerank.request.v2',
    messageKey: '22222222-2222-4222-8222-222222222222',
    eventType: 'catalogue.recommendation.rerank.requested',
    aggregateType: 'recommendation-request',
    aggregateId: '22222222-2222-4222-8222-222222222222',
    deduplicationKey: null,
    payload: {
      eventId: '11111111-1111-4111-8111-111111111111',
      eventType: 'catalogue.recommendation.rerank.requested',
      eventVersion: 2,
    },
    attempts: 0,
    availableAt: now,
    publishedAt: null,
    claimedAt: now,
    claimToken: '33333333-3333-4333-8333-333333333333',
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };

  let service: OutboxPublisherService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    jest.resetAllMocks();

    // Значения по умолчанию для пустого цикла publisher.
    findPending.mockResolvedValue([]);
    markPublished.mockResolvedValue(true);
    markFailed.mockResolvedValue(true);

    service = new OutboxPublisherService(
      repository,
      producer,
      {
        getOrThrow: jest.fn().mockReturnValue({ enabled: true }),
      } as unknown as ConfigService
    );
  });

  afterEach(async () => {
    // Убираем следующий запланированный polling timer.
    await service.beforeApplicationShutdown();
    jest.useRealTimers();
  });

  it('publishes a pending message and marks it as published', async () => {
    findPending.mockResolvedValueOnce([message]);
    produce.mockResolvedValue([]);

    service.onApplicationBootstrap();

    // Выполняем первый polling, который был запланирован с задержкой 0.
    await jest.advanceTimersByTimeAsync(0);

    expect(produce).toHaveBeenCalledWith({
      topic: message.topic,
      acks: -1,
      messages: [
        {
          key: message.messageKey,
          value: JSON.stringify(message.payload),
          headers: {
            'content-type': 'application/json',
            'event-id': message.id,
            'event-type': message.eventType,
          },
        },
      ],
    });

    // Событие помечается опубликованным только после produce().
    expect(markPublished).toHaveBeenCalledWith({
      id: message.id,
      claimToken: message.claimToken,
      publishedAt: now,
    });

    expect(markFailed).not.toHaveBeenCalled();
  });

  it('does not poll Outbox when Kafka is disabled', async () => {
    const disabled = new OutboxPublisherService(
      repository,
      producer,
      {
        getOrThrow: jest.fn().mockReturnValue({ enabled: false }),
      } as unknown as ConfigService
    );

    disabled.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(10_000);

    expect(findPending).not.toHaveBeenCalled();
    expect(produce).not.toHaveBeenCalled();
    await disabled.beforeApplicationShutdown();
  });

  it('schedules retry when Kafka publishing fails', async () => {
    findPending.mockResolvedValueOnce([message]);
    produce.mockRejectedValueOnce(new Error('Kafka unavailable'));

    service.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(0);

    expect(markPublished).not.toHaveBeenCalled();

    expect(markFailed).toHaveBeenCalledWith({
      id: message.id,
      claimToken: message.claimToken,

      // Для первой ошибки backoff равен одной секунде.
      availableAt: new Date(now.getTime() + 1_000),

      lastError: 'Kafka unavailable',
    });
  });

  it('caps exponential backoff and stored error size', async () => {
    const exhausted = {
      ...message,
      attempts: 100,
    };
    findPending.mockResolvedValueOnce([exhausted]);
    produce.mockRejectedValueOnce(new Error('x'.repeat(3_000)));

    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);

    expect(markFailed).toHaveBeenCalledWith({
      id: message.id,
      claimToken: message.claimToken,
      availableAt: new Date(now.getTime() + 60_000),
      lastError: 'x'.repeat(2_000),
    });
  });

  it('does not convert a concurrently published row back to failed', async () => {
    findPending.mockResolvedValueOnce([message]);
    produce.mockRejectedValueOnce('Kafka unavailable');
    markFailed.mockResolvedValueOnce(false);

    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);

    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(markPublished).not.toHaveBeenCalled();
  });

  it('does not fail when another publisher already marked the row', async () => {
    findPending.mockResolvedValueOnce([message]);
    produce.mockResolvedValueOnce([]);
    markPublished.mockResolvedValueOnce(false);

    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);

    expect(markPublished).toHaveBeenCalledTimes(1);
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('keeps polling after a batch-level database failure', async () => {
    findPending
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce([]);

    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(1_000);

    expect(findPending).toHaveBeenCalledTimes(2);
  });
});
