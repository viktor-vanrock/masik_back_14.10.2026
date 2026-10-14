import { ConfigService } from '@nestjs/config';
import ms, { StringValue } from 'ms';
import {
  AgentEnvType,
  EmbeddingEnvType,
  KafkaEnvType,
  RecommendationEnvType,
} from './types';

const assertTrustedOrigin = (value: string): void => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('TRUSTED_ORIGINS contains an invalid entry: expected an exact http(s) origin.');
  }

  const pathnameOk = '' === url.pathname || '/' === url.pathname;
  const protocolOk = 'http:' === url.protocol || 'https:' === url.protocol;

  if (
    !protocolOk ||
    !url.host ||
    '' !== url.username ||
    '' !== url.password ||
    '' !== url.search ||
    '' !== url.hash ||
    !pathnameOk
  ) {
    throw new Error('TRUSTED_ORIGINS contains an invalid entry: expected an exact http(s) origin without credentials, path, query, or hash.');
  }
};

export function assertEnvConfig(configService: ConfigService): void {
  const nodeEnv = configService.get<string>('nodeEnv');
  const jwtAccessSecret = configService.get<string>('jwtAccessSecret');
  if (!jwtAccessSecret || 0 === jwtAccessSecret.trim().length) {
    throw new Error('JWT_ACCESS_SECRET is required: set a non-empty value.');
  }

  const jwtAccessExpire = configService.get<StringValue>('jwtAccessExpire');
  const duration = jwtAccessExpire ? ms(jwtAccessExpire) : undefined;
  if ('number' !== typeof duration || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('JWT_ACCESS_EXPIRE is invalid: expected a positive duration such as "7d".');
  }

  const trustedOrigins = configService.get<string[]>('trustedOrigins') ?? [];
  for (const value of trustedOrigins) {
    assertTrustedOrigin(value);
  }

  const agent = configService.get<AgentEnvType>('agent');
  if (!agent) {
    throw new Error('Interviewer configuration is missing.');
  }
  if (
    'production' === nodeEnv &&
    'mock' === agent.mode
  ) {
    throw new Error('AGENT_MODE=mock is not allowed in production.');
  }

  const kafka = configService.get<KafkaEnvType>('kafka');
  if (!kafka) {
    throw new Error('Kafka configuration is missing.');
  }
  if (!kafka.enabled && 'test' !== nodeEnv) {
    throw new Error(
      'KAFKA_ENABLED=true is required for Benchmark service integration.'
    );
  }
  const usesMtlsKafka = kafka.brokers.some((broker) =>
    broker.endsWith(':9094')
  );
  if (
    kafka.enabled &&
    !kafka.ssl &&
    ('production' === nodeEnv || usesMtlsKafka)
  ) {
    throw new Error(
      'KAFKA_SSL_CA_FILE, KAFKA_SSL_CERT_FILE and KAFKA_SSL_KEY_FILE are required for Kafka mTLS.'
    );
  }
  if ('ws' === agent.mode) {
    try {
      const interviewerUrl = new URL(agent.wsUrl);
      if (!['ws:', 'wss:'].includes(interviewerUrl.protocol)) {
        throw new Error('unsupported protocol');
      }
    } catch {
      throw new Error(
        'THIRD_PARTY_WS_URL must be a valid WS(S) URL when AGENT_MODE=ws.'
      );
    }

    const integerSettings = [
      ['AGENT_MAX_ACTIVE_SESSIONS', agent.maxActiveSessions],
      [
        'AGENT_MAX_PENDING_MESSAGES_PER_SESSION',
        agent.maxPendingMessagesPerSession,
      ],
      ['AGENT_MAX_BUFFERED_BYTES_PER_SESSION', agent.maxBufferedBytesPerSession],
      ['AGENT_MAX_PAYLOAD_BYTES', agent.maxPayloadBytes],
      ['AGENT_SESSION_IDLE_TIMEOUT_MS', agent.sessionIdleTimeoutMs],
    ] as const;
    for (const [name, value] of integerSettings) {
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer.`);
      }
    }
    if (agent.maxPayloadBytes > agent.maxBufferedBytesPerSession) {
      throw new Error(
        'AGENT_MAX_PAYLOAD_BYTES cannot exceed ' +
        'AGENT_MAX_BUFFERED_BYTES_PER_SESSION.'
      );
    }
    if (agent.heartbeatTimeoutMs >= agent.heartbeatIntervalMs) {
      throw new Error(
        'AGENT_HEARTBEAT_TIMEOUT_MS must be less than ' +
        'AGENT_HEARTBEAT_INTERVAL_MS.'
      );
    }
  }

  const embedding = configService.get<EmbeddingEnvType>('embedding');
  if (!embedding) {
    throw new Error('Embedding configuration is missing.');
  }

  if (
    'production' === nodeEnv &&
    'mock' === embedding.provider
  ) {
    throw new Error(
      'EMBEDDING_PROVIDER=mock is not allowed in production.'
    );
  }

  if ('gigachat' === embedding.provider) {
    if (!embedding.credentials || !embedding.authUrl || !embedding.scope) {
      throw new Error('GIGACHAT_CREDENTIALS, GIGACHAT_AUTH_URL and GIGACHAT_SCOPE are required.');
    }
    for (const value of [embedding.url, embedding.authUrl]) {
      try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
      } catch {
        throw new Error('GigaChat embedding and authorization URLs must be valid HTTP(S) URLs.');
      }
    }
    if (1024 !== embedding.dimensions || 1024 !== embedding.sourceDimensions) {
      throw new Error('GigaChat Embeddings-2 requires 1024 dimensions.');
    }
  }

  if ('gigachat' !== embedding.provider && 1_536 !== embedding.dimensions) {
    throw new Error('EMBEDDING_DIMENSIONS must be exactly 1536.');
  }

  if ('gigachat' !== embedding.provider && 4_096 !== embedding.sourceDimensions) {
    throw new Error('EMBEDDING_SOURCE_DIMENSIONS must be exactly 4096.');
  }

  if (embedding.retrievalCandidateLimit > 100) {
    throw new Error(
      'RETRIEVAL_CANDIDATE_LIMIT cannot exceed 100.'
    );
  }

  const recommendation =
    configService.get<RecommendationEnvType>('recommendation');
  if (
    !recommendation ||
    !Number.isInteger(recommendation.maxConcurrentExecutions) ||
    recommendation.maxConcurrentExecutions <= 0
  ) {
    throw new Error(
      'RECOMMENDATION_MAX_CONCURRENT_EXECUTIONS must be a positive integer.'
    );
  }

}
