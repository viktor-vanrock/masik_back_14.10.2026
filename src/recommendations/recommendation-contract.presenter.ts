import { Prisma } from '@/generated/prisma/client';

/**
 * Older RecommendationRequest rows stored a BenchmarkTest id under the
 * misleading `benchmarkId` key. Keep the public read contract canonical even
 * during a rolling deployment or before a historical row is migrated.
 */
export function presentRecommendationResultPayload(
  value: Prisma.JsonValue | null
): Prisma.JsonValue | null {
  if (!Array.isArray(value)) return value;

  return value.map((item) => presentTestTargetObject(item));
}

export function presentTestTargetObject(
  value: Prisma.JsonValue | null
): Prisma.JsonValue | null {
  if (!isJsonObject(value)) return value;

  const { benchmarkId, ...canonical } = value;
  if ('string' === typeof canonical.testId) return canonical;
  if ('string' !== typeof benchmarkId) return canonical;

  return { ...canonical, testId: benchmarkId };
}

function isJsonObject(
  value: Prisma.JsonValue | null
): value is Prisma.JsonObject {
  return null !== value && 'object' === typeof value && !Array.isArray(value);
}
