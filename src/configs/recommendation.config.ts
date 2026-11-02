import { registerAs } from '@nestjs/config';
import { parseIntWithFallback } from '@/common/utils/parseIntWithFallback';
import type { RecommendationEnvType } from './types';

const selectionProvider = (): 'retrieval' | 'factory' => {
  const value = process.env.RECOMMENDATION_SELECTION_PROVIDER?.trim() || 'retrieval';
  // Retire the old external reranker even when its Vault flag remains set.
  if ('reranker' === value) return 'retrieval';
  if ('retrieval' !== value && 'factory' !== value) {
    throw new Error('RECOMMENDATION_SELECTION_PROVIDER must be retrieval or factory.');
  }
  return value;
};

export default registerAs(
  'recommendation',
  (): RecommendationEnvType => ({
    selectionProvider: selectionProvider(),
    maxConcurrentExecutions: parseIntWithFallback(
      process.env.RECOMMENDATION_MAX_CONCURRENT_EXECUTIONS,
      16
    ),
  })
);
