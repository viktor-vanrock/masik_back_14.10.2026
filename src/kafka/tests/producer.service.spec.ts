import { ConfigService } from '@nestjs/config';
import { Kafka, Producer, ProducerRecord } from 'kafkajs';
import { ProducerService } from '../producer.service';

describe('ProducerService', () => {
  const producer = {
    connect: jest.fn(),
    disconnect: jest.fn(),
    send: jest.fn(),
  };
  const config = {
    enabled: true,
    clientId: 'benchmark-catalog',
    brokers: ['localhost:9092'],
    connectionTimeoutMs: 5_000,
    requestTimeoutMs: 30_000,
  };
  const getOrThrow = jest.fn().mockReturnValue(config);
  const configService = { getOrThrow } as unknown as ConfigService;
  const record: ProducerRecord = {
    topic: 'benchmark.commands.v1',
    messages: [{ key: 'test-id', value: '{}' }],
  };

  let service: ProducerService;

  beforeEach(() => {
    jest.clearAllMocks();
    getOrThrow.mockReturnValue(config);
    jest
      .spyOn(Kafka.prototype, 'producer')
      .mockReturnValue(producer as unknown as Producer);
    producer.connect.mockResolvedValue(undefined);
    producer.disconnect.mockResolvedValue(undefined);
    producer.send.mockResolvedValue([]);
    service = new ProducerService(configService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('shares one in-flight connection between concurrent publishes', async () => {
    await Promise.all([service.produce(record), service.produce(record)]);

    expect(producer.connect).toHaveBeenCalledTimes(1);
    expect(producer.send).toHaveBeenCalledTimes(2);
    expect(producer.send).toHaveBeenCalledWith(record);
  });

  it('reuses an established connection for later publishes', async () => {
    await service.produce(record);
    await service.produce(record);

    expect(producer.connect).toHaveBeenCalledTimes(1);
  });

  it('allows a later publish to reconnect after a failed attempt', async () => {
    producer.connect
      .mockRejectedValueOnce(new Error('Kafka unavailable'))
      .mockResolvedValueOnce(undefined);

    await expect(service.produce(record)).rejects.toThrow('Kafka unavailable');
    await expect(service.produce(record)).resolves.toEqual([]);
    expect(producer.connect).toHaveBeenCalledTimes(2);
    expect(producer.send).toHaveBeenCalledTimes(1);
  });

  it('disconnects only an established producer on shutdown', async () => {
    await service.produce(record);
    await service.onApplicationShutdown();

    expect(producer.disconnect).toHaveBeenCalledTimes(1);
    await expect(service.produce(record)).rejects.toThrow(
      'Kafka producer is shutting down'
    );
  });

  it('does not disconnect when shutdown happens before a connection', async () => {
    await service.onApplicationShutdown();

    expect(producer.disconnect).not.toHaveBeenCalled();
  });

  it('starts a non-blocking eager connection on module initialization', async () => {
    producer.connect.mockRejectedValueOnce('Kafka unavailable');

    service.onModuleInit();
    await new Promise((resolve) => setImmediate(resolve));

    expect(producer.connect).toHaveBeenCalledTimes(1);
  });

  it('does not connect and rejects accidental direct publishing when disabled', async () => {
    getOrThrow.mockReturnValue({ ...config, enabled: false });
    service = new ProducerService(configService);

    service.onModuleInit();
    await expect(service.produce(record)).rejects.toThrow(
      'Kafka producer is disabled'
    );
    expect(producer.connect).not.toHaveBeenCalled();
    expect(producer.send).not.toHaveBeenCalled();
  });
});
