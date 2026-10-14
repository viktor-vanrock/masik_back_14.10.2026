import type { ConnectionOptions } from 'node:tls';

export type EnvType = {
  nodeEnv: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  jwtAccessExpire: string;
  jwtRefreshExpire: string;
  trustedOrigins: string[];
  originTrustForwardedHeaders: boolean;
};

export type AdminUserEnvType = {
  seedEnabled: boolean;
  username: string;
  email: string;
  password: string;
};

export type DatabaseEnvType = {
  host: string;
  port: number;
  username: string;
  password: string;
  name: string;
  url: string;
};

export type RedisEnvType = {
  password: string;
  host: string;
  port: number;
};

export type AgentMode = 'mock' | 'ws';

export type AgentEnvType = {
  mode: AgentMode;
  wsUrl: string;
  selectionUrl?: string;
  selectionTimeoutMs?: number;
  apiKey: string;
  maxActiveSessions: number;
  maxPendingMessagesPerSession: number;
  maxBufferedBytesPerSession: number;
  maxPayloadBytes: number;
  sessionIdleTimeoutMs: number;
  reconnectInitialDelayMs: number;
  reconnectMaxDelayMs: number;
  reconnectMaxAttempts: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
};

export type VaultEnvType = {
  address: string;
  token: string;
  tokenFile: string;
  namespace: string;
  transitMount: string;
  hmacKeyName: string;
  timeoutMs: number;
};

export type KafkaEnvType = {
  enabled: boolean;
  clientId: string;
  brokers: string[];
  ssl?: ConnectionOptions;
  consumerGroupId: string;
  connectionTimeoutMs: number;
  requestTimeoutMs: number;
  consumerRestartDelayMs: number;
  consumerMaxProcessingAttempts: number;
  recommendationMaxAttempts: number;
  recommendationRetryBaseDelayMs: number;
  recommendationRetryMaxDelayMs: number;
};

export type EmbeddingProviderMode = 'mock' | 'gigachat';

export type EmbeddingEnvType = {
  credentials?: string;
  authUrl?: string;
  scope?: string;
  provider: EmbeddingProviderMode;
  url: string;
  apiKey: string;
  model: string;
  specId: string;
  dimensions: number;
  sourceDimensions: number;
  queryInstruction: string;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  retrievalCandidateLimit: number;
  batchSize: number;
};

export type RecommendationEnvType = {
  selectionProvider?: 'retrieval' | 'factory';
  maxConcurrentExecutions: number;
};
