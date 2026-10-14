import { registerAs } from '@nestjs/config';
import { EmbeddingEnvType } from './types';

// Pin the released model/spec together: stale Qwen Vault values must never
// redirect GigaChat requests or mix 1536-dimensional vectors into its index.
export const GIGACHAT_SEARCH_CONFIG = {
  provider: 'gigachat',
  model: 'Embeddings-2',
  dimensions: 1024,
  sourceDimensions: 1024,
  specId: 'gigachat:Embeddings-2:benchmark-test-document-v1:dim-1024:l2:chunk400b-mean-v1',
  timeoutMs: 120_000,
  maxRetries: 2,
  retryDelayMs: 250,
  retrievalCandidateLimit: 20,
  batchSize: 16,
} as const;

export default registerAs('embedding', (): EmbeddingEnvType => {
  const configured = process.env.EMBEDDING_PROVIDER?.trim();
  if (configured && !['mock', 'gigachat', 'openai-compatible'].includes(configured)) {
    throw new Error('EMBEDDING_PROVIDER must be gigachat or mock (local tests only).');
  }
  if ('mock' === configured) {
    return {
      ...GIGACHAT_SEARCH_CONFIG,
      provider: 'mock', url: '', apiKey: '', queryInstruction: '',
      model: 'mock-hashed-bow-v1',
      specId: 'mock-hashed-bow-v1:benchmark-test-document-v1:dim-1536:l2',
      dimensions: 1536, sourceDimensions: 4096, batchSize: 32,
    };
  }
  // openai-compatible is a legacy deployment value, not an available transport.
  // Only GIGACHAT_* connection settings are read for the real provider.
  const baseUrl = (process.env.GIGACHAT_BASE_URL?.trim() || '').replace(/\/+$/, '');
  return {
    ...GIGACHAT_SEARCH_CONFIG,
    url: baseUrl ? `${baseUrl}/embeddings` : '',
    credentials: process.env.GIGACHAT_CREDENTIALS?.trim() || '',
    authUrl: process.env.GIGACHAT_AUTH_URL?.trim() || '',
    scope: process.env.GIGACHAT_SCOPE?.trim() || 'GIGACHAT_API_CORP',
    apiKey: '', queryInstruction: '',
  };
});
