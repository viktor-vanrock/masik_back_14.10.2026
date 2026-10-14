import embeddingConfig, { GIGACHAT_SEARCH_CONFIG } from './embedding.config';
import recommendationConfig from './recommendation.config';

describe('released GigaChat search configuration', () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { NODE_ENV: 'test' }; });
  afterEach(() => { process.env = originalEnv; });

  it.each(['dev', 'development', 'production'])('uses GigaChat by default in %s', (nodeEnv) => {
    process.env.NODE_ENV = nodeEnv;
    expect(embeddingConfig()).toEqual(expect.objectContaining(GIGACHAT_SEARCH_CONFIG));
  });

  it('ignores stale Qwen endpoints, credentials, model and vector overrides', () => {
    Object.assign(process.env, {
      EMBEDDING_PROVIDER: 'openai-compatible', EMBEDDING_URL: 'http://unavailable.example:8004/v1/embeddings',
      EMBEDDING_API_KEY: 'obsolete-key', EMBEDDING_MODEL: 'old-Qwen',
      EMBEDDING_DIMENSIONS: '1536', EMBEDDING_SOURCE_DIMENSIONS: '4096',
      EMBEDDING_SPEC_ID: 'obsolete-spec', RETRIEVAL_INSTRUCTION: 'old instruction',
      GIGACHAT_BASE_URL: 'https://gigachat.example/api/v1/',
      GIGACHAT_AUTH_URL: 'https://auth.example/oauth', GIGACHAT_CREDENTIALS: 'gigachat-basic',
    });
    expect(embeddingConfig()).toEqual({
      ...GIGACHAT_SEARCH_CONFIG,
      url: 'https://gigachat.example/api/v1/embeddings',
      authUrl: 'https://auth.example/oauth', credentials: 'gigachat-basic',
      scope: 'GIGACHAT_API_CORP', apiKey: '', queryInstruction: '',
    });
  });

  it('keeps mock vectors explicitly isolated for local tests', () => {
    process.env.EMBEDDING_PROVIDER = 'mock';
    expect(embeddingConfig()).toEqual(expect.objectContaining({
      provider: 'mock', dimensions: 1536, model: 'mock-hashed-bow-v1', url: '',
      specId: 'mock-hashed-bow-v1:benchmark-test-document-v1:dim-1536:l2',
    }));
  });

  it('does not synthesize an endpoint when GigaChat base URL is absent', () => {
    expect(embeddingConfig().url).toBe('');
  });

  it('rejects misspelled providers', () => {
    process.env.EMBEDDING_PROVIDER = 'giga-typo';
    expect(() => embeddingConfig()).toThrow('EMBEDDING_PROVIDER');
  });

  it.each([undefined, 'reranker', 'retrieval'])('retires the external reranker for %s', (provider) => {
    if (provider) process.env.RECOMMENDATION_SELECTION_PROVIDER = provider;
    process.env.RERANKER_PROVIDER = 'qwen-compatible';
    process.env.RERANKER_URL = 'http://unavailable.example/rerank';
    expect(recommendationConfig().selectionProvider).toBe('retrieval');
  });

  it('retains explicit Factory selection as a separate optional stage', () => {
    process.env.RECOMMENDATION_SELECTION_PROVIDER = 'factory';
    expect(recommendationConfig().selectionProvider).toBe('factory');
  });
});
