import { ConfigService } from '@nestjs/config';
import { Admin, Kafka } from 'kafkajs';
import { KafkaHealthService } from '../kafka-health.service';
import { KAFKA_TOPICS } from '../kafka.constants';

describe('KafkaHealthService', () => {
  const admin = {
    connect: jest.fn(),
    fetchTopicMetadata: jest.fn(),
    disconnect: jest.fn(),
  };
  const configService = {
    getOrThrow: jest.fn().mockReturnValue({
      enabled: true,
      clientId: 'benchmark-catalog',
      brokers: ['localhost:9092'],
      connectionTimeoutMs: 5_000,
      requestTimeoutMs: 30_000,
    }),
  } as unknown as ConfigService;
  let service: KafkaHealthService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Kafka.prototype, 'admin').mockReturnValue(admin as unknown as Admin);
    admin.connect.mockResolvedValue(undefined);
    admin.disconnect.mockResolvedValue(undefined);
    admin.fetchTopicMetadata.mockResolvedValue({
      topics: Object.values(KAFKA_TOPICS).map((name) => ({ name })),
    });
    service = new KafkaHealthService(configService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('reports ready only when every contractual topic exists', async () => {
    await expect(service.check()).resolves.toEqual({
      latencyMs: expect.any(Number),
      topics: Object.values(KAFKA_TOPICS),
    });
    expect(admin.fetchTopicMetadata).toHaveBeenCalledWith({
      topics: Object.values(KAFKA_TOPICS),
    });
    expect(admin.disconnect).toHaveBeenCalledTimes(1);
  });

  it('reports every missing contractual topic and still disconnects', async () => {
    admin.fetchTopicMetadata.mockResolvedValue({ topics: [] });

    await expect(service.check()).rejects.toThrow(
      `Kafka topics are missing: ${Object.values(KAFKA_TOPICS).join(', ')}`
    );
    expect(admin.disconnect).toHaveBeenCalledTimes(1);
  });

  it('preserves broker errors and suppresses cleanup errors', async () => {
    admin.fetchTopicMetadata.mockRejectedValue(new Error('broker unavailable'));
    admin.disconnect.mockRejectedValue(new Error('disconnect failed'));

    await expect(service.check()).rejects.toThrow('broker unavailable');
    expect(admin.disconnect).toHaveBeenCalledTimes(1);
  });
});
