import { ConfigService } from '@nestjs/config';
import { Kafka } from 'kafkajs';
import { ConsumerService } from '../consumer.service';

describe('ConsumerService', () => {
  const handlers = new Map<string, () => void>();
  const consumer = {
    events: {
      CONNECT: 'consumer.connect',
      DISCONNECT: 'consumer.disconnect',
      CRASH: 'consumer.crash',
    },
    on: jest.fn((event: string, handler: () => void) => {
      handlers.set(event, handler);
    }),
    connect: jest.fn(),
    subscribe: jest.fn(),
    run: jest.fn(),
    disconnect: jest.fn(),
  };
  const config = {
    enabled: true,
    clientId: 'benchmark-catalog',
    brokers: ['localhost:9092'],
    consumerGroupId: 'catalog-group',
    connectionTimeoutMs: 5_000,
    requestTimeoutMs: 30_000,
  };
  const configService = {
    getOrThrow: jest.fn().mockReturnValue(config),
  } as unknown as ConfigService;
  const createConsumer = jest.fn();

  let service: ConsumerService;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers.clear();
    jest
      .spyOn(Kafka.prototype, 'consumer')
      .mockImplementation(createConsumer);
    createConsumer.mockReturnValue(consumer);
    consumer.connect.mockImplementation(async () => {
      handlers.get(consumer.events.CONNECT)?.();
    });
    consumer.subscribe.mockResolvedValue(undefined);
    consumer.run.mockResolvedValue(undefined);
    consumer.disconnect.mockResolvedValue(undefined);
    service = new ConsumerService(configService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('connects, subscribes, runs, and reports business consumer readiness', async () => {
    const subscription = { topics: ['benchmark.events.v1'] };
    const runConfig = { eachMessage: jest.fn() };

    await service.consume(subscription, runConfig);

    expect(createConsumer).toHaveBeenCalledWith({
      groupId: 'catalog-group',
      allowAutoTopicCreation: false,
    });
    expect(consumer.subscribe).toHaveBeenCalledWith(subscription);
    expect(consumer.run).toHaveBeenCalledWith(runConfig);
    expect(service.isConnected()).toBe(true);
  });

  it('removes readiness on disconnect and crash events', async () => {
    await service.consume({ topics: ['benchmark.events.v1'] }, { eachMessage: jest.fn() });

    handlers.get(consumer.events.DISCONNECT)?.();
    expect(service.isConnected()).toBe(false);

    handlers.get(consumer.events.CONNECT)?.();
    expect(service.isConnected()).toBe(true);
    handlers.get(consumer.events.CRASH)?.();
    expect(service.isConnected()).toBe(false);
  });

  it('disconnects a partially initialized consumer and preserves the failure', async () => {
    consumer.subscribe.mockRejectedValue(new Error('topic missing'));
    consumer.disconnect.mockRejectedValueOnce(new Error('cleanup failed'));

    await expect(
      service.consume({ topics: ['missing'] }, { eachMessage: jest.fn() })
    ).rejects.toThrow('topic missing');
    expect(consumer.disconnect).toHaveBeenCalledTimes(1);
    expect(service.isConnected()).toBe(false);
  });

  it('disconnects every successfully started consumer during shutdown', async () => {
    const secondConsumer = {
      ...consumer,
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockResolvedValue(undefined),
      run: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
    createConsumer
      .mockReturnValueOnce(consumer)
      .mockReturnValueOnce(secondConsumer);

    await service.consume({ topics: ['one'] }, { eachMessage: jest.fn() });
    await service.consume({ topics: ['two'] }, { eachMessage: jest.fn() });
    await service.onApplicationShutdown();

    expect(consumer.disconnect).toHaveBeenCalledTimes(1);
    expect(secondConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(service.isConnected()).toBe(false);
  });
});
