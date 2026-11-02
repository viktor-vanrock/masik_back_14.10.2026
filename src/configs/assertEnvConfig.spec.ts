import { ConfigService } from '@nestjs/config';
import { assertEnvConfig } from './assertEnvConfig';
import embeddingConfig from './embedding.config';
import type {
  AgentEnvType,
  EmbeddingEnvType,
  KafkaEnvType,
  RecommendationEnvType,
} from './types';

describe('assertEnvConfig benchmark topology', () => {
  it('requires Kafka for Benchmark Service integration', () => {
    const config = validConfig({ enabled: false });

    expect(() => assertEnvConfig(config)).toThrow(
      'KAFKA_ENABLED=true is required for Benchmark service integration'
    );
  });

  it('accepts the Kafka-backed Benchmark Service topology', () => {
    expect(() => assertEnvConfig(validConfig())).not.toThrow();
  });

  it('allows Kafka to be disabled only in isolated tests', () => {
    const config = validConfig({ enabled: false }, 'test');

    expect(() => assertEnvConfig(config)).not.toThrow();
  });

  it('accepts released GigaChat without any external reranker configuration', () => {
    const originalEnv = process.env;
    process.env = {
      NODE_ENV: 'production', EMBEDDING_PROVIDER: 'openai-compatible',
      EMBEDDING_URL: 'http://retired.example:8004/v1/embeddings',
      GIGACHAT_BASE_URL: 'https://gigachat.example/api/v1',
      GIGACHAT_AUTH_URL: 'https://auth.example/oauth',
      GIGACHAT_CREDENTIALS: 'synthetic-basic',
    };
    try {
      const config = validConfig({}, 'dev', embeddingConfig());
      expect(() => assertEnvConfig(config)).not.toThrow();
      expect(embeddingConfig().url).toBe('https://gigachat.example/api/v1/embeddings');
    } finally { process.env = originalEnv; }
  });

  it('requires GigaChat credentials instead of silently using a retired embedding URL', () => {
    const originalEnv = process.env;
    process.env = { EMBEDDING_PROVIDER: 'openai-compatible', EMBEDDING_URL: 'http://retired.example:8004' };
    try {
      expect(() => assertEnvConfig(validConfig({}, 'dev', embeddingConfig())))
        .toThrow('GIGACHAT_CREDENTIALS');
    } finally { process.env = originalEnv; }
  });

  it('requires mTLS for a broker on port 9094', () => {
    expect(() =>
      assertEnvConfig(validConfig({ brokers: ['dev-broker:9094'] }))
    ).toThrow('required for Kafka mTLS');

    expect(() =>
      assertEnvConfig(
        validConfig({
          brokers: ['dev-broker:9094'],
          ssl: {
            ca: Buffer.from('ca'),
            cert: Buffer.from('cert'),
            key: Buffer.from('key'),
          },
        })
      )
    ).not.toThrow();
  });
});

function validConfig(
  kafkaOverrides: Partial<KafkaEnvType> = {},
  nodeEnv = 'dev',
  embeddingOverride?: EmbeddingEnvType
): ConfigService {
  const agent: AgentEnvType = {
    mode: 'mock',
    wsUrl: '',
    apiKey: '',
    maxActiveSessions: 1,
    maxPendingMessagesPerSession: 1,
    maxBufferedBytesPerSession: 1,
    maxPayloadBytes: 1,
    sessionIdleTimeoutMs: 1,
    reconnectInitialDelayMs: 1,
    reconnectMaxDelayMs: 1,
    reconnectMaxAttempts: 1,
    heartbeatIntervalMs: 2,
    heartbeatTimeoutMs: 1,
  };
  const kafka: KafkaEnvType = {
    enabled: true,
    clientId: 'catalog-test',
    brokers: ['localhost:9092'],
    consumerGroupId: 'catalog-test',
    connectionTimeoutMs: 1,
    requestTimeoutMs: 1,
    consumerRestartDelayMs: 1,
    consumerMaxProcessingAttempts: 1,
    recommendationMaxAttempts: 1,
    recommendationRetryBaseDelayMs: 1,
    recommendationRetryMaxDelayMs: 1,
    ...kafkaOverrides,
  };
  const embedding: EmbeddingEnvType = {
    provider: 'mock',
    url: '',
    apiKey: '',
    model: 'mock',
    specId: 'mock',
    dimensions: 1_536,
    sourceDimensions: 4_096,
    queryInstruction: '',
    timeoutMs: 1,
    maxRetries: 1,
    retryDelayMs: 1,
    retrievalCandidateLimit: 10,
    batchSize: 1,
  };
  const recommendation: RecommendationEnvType = {
    maxConcurrentExecutions: 1,
  };
  const values = new Map<string, unknown>([
    ['nodeEnv', nodeEnv],
    ['jwtAccessSecret', 'test-secret'],
    ['jwtAccessExpire', '1h'],
    ['trustedOrigins', []],
    ['agent', agent],
    ['kafka', kafka],
    ['embedding', embeddingOverride ?? embedding],
    ['recommendation', recommendation],
  ]);

  return {
    get: jest.fn((key: string) => values.get(key)),
  } as unknown as ConfigService;
}
