export const EXTERNAL_API_KEY_SCOPES_KEY =
  'external-api-key-required-scopes';

export const EXTERNAL_API_KEY_SCOPE = {
  BENCHMARK_TESTS_READ: 'benchmark-tests:read',
  METRIC_DEFINITIONS_READ: 'metric-definitions:read',
  METRIC_DEFINITIONS_WRITE: 'metric-definitions:write',
  MODELS_READ: 'models:read',
  MODELS_WRITE: 'models:write',
  METRIC_RESULTS_READ: 'metric-results:read',
  METRIC_RESULTS_WRITE: 'metric-results:write',
} as const;

export const EXTERNAL_API_KEY_SCOPES = Object.values(
  EXTERNAL_API_KEY_SCOPE
);

export const DEFAULT_EXTERNAL_API_KEY_SCOPES = [
  EXTERNAL_API_KEY_SCOPE.BENCHMARK_TESTS_READ,
];

export const EXTERNAL_API_KEY_STATUS = {
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
} as const;
