import { MetricDefinition } from '@/generated/prisma/client';

type TestOwnedMetricFields =
  | 'evaluationLogic'
  | 'requiredGigaChatQualityLevel';

export type MetricDefinitionContract = Omit<
  MetricDefinition,
  TestOwnedMetricFields
>;

/**
 * Defensive API-boundary cleanup for legacy objects and stale integrations.
 * Neither field is persisted by MetricDefinition because both belong to Test.
 */
export function presentMetricDefinition<T extends object>(
  metric: T
): Omit<T, TestOwnedMetricFields> {
  const contract = { ...metric } as T & {
    evaluationLogic?: unknown;
    requiredGigaChatQualityLevel?: unknown;
  };
  delete contract.evaluationLogic;
  delete contract.requiredGigaChatQualityLevel;

  return contract;
}

export function presentMetricResult<T extends object>(result: T): T {
  const withMetric = result as T & { metric?: object };
  if (!withMetric.metric) return result;

  return {
    ...result,
    metric: presentMetricDefinition(withMetric.metric),
  };
}
