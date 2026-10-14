const setDefault = (name: string, value: string): void => {
  if (!process.env[name]) {
    process.env[name] = value;
  }
};

setDefault('NODE_ENV', 'test');
setDefault(
  'DB_URL',
  'postgresql://benchmark_catalog_test:benchmark_catalog_test@127.0.0.1:55432/benchmark_catalog_test?schema=public'
);
setDefault('DATABASE_URL', process.env.DB_URL!);

setDefault('JWT_ACCESS_SECRET', 'e2e-only-access-secret');
setDefault('JWT_REFRESH_SECRET', 'e2e-only-refresh-secret');
setDefault('JWT_ACCESS_EXPIRE', '1h');
setDefault('JWT_REFRESH_EXPIRE', '1d');
setDefault('TRUSTED_ORIGINS', 'http://127.0.0.1');
setDefault('ORIGIN_TRUST_FORWARDED_HEADERS', 'false');
setDefault('ADMIN_SEED_ENABLED', 'false');
setDefault('KAFKA_ENABLED', 'false');

setDefault('AGENT_MODE', 'mock');
setDefault('EMBEDDING_PROVIDER', 'mock');
setDefault('EMBEDDING_MODEL', 'mock-hashed-bow-v1');
setDefault('EMBEDDING_SPEC_ID', 'mock-hashed-bow-v1:benchmark-test-document-v1:dim-1536:l2');
setDefault('EMBEDDING_DIMENSIONS', '1536');
setDefault('EMBEDDING_SOURCE_DIMENSIONS', '4096');
setDefault('RERANKER_PROVIDER', 'mock');
setDefault('RERANKER_MODEL', 'mock-lexical-reranker-v1');
