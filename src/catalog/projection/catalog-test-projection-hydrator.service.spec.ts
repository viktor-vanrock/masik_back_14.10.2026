import { PrismaService } from '@/prisma/prisma.service';
import { CatalogTestProjectionHydrator } from './catalog-test-projection-hydrator.service';

describe('Catalog result projection source modes', () => {
  it.each([
    { value: null, expected: undefined },
    { value: '', expected: undefined },
    { value: 'abc', expected: undefined },
    { value: NaN, expected: undefined },
    { value: 0, expected: 0 },
    { value: '12.5', expected: 12.5 },
  ])('reads finite numeric metadata from $value', ({ value, expected }) => {
    const hydrator = new CatalogTestProjectionHydrator({} as PrismaService);
    const [score] = (hydrator as any).toMetricScores([{
      modelId: 'model', metricId: 'metric', sourceMode: 'benchmark', value: 90,
      metadata: { auqtc: value, tokensPerSec: value },
      model: { id: 'model', name: 'Model', isOpenSource: false, architecture: null },
      metric: { id: 'metric', name: 'Accuracy' },
      obtainedAt: new Date('2026-10-23'),
    }]) as Array<{ auqtc?: number; tokensPerSec?: number }>;

    expect(score.auqtc).toBe(expected);
    expect(score.tokensPerSec).toBe(expected);
    expect(Object.hasOwn(score, 'auqtc')).toBe(expected !== undefined);
    expect(Object.hasOwn(score, 'tokensPerSec')).toBe(expected !== undefined);
  });

  it('keeps the latest score per mode so benchmark and harness remain selectable independently', () => {
    const hydrator = new CatalogTestProjectionHydrator({} as PrismaService);
    const row = {
      modelId: 'model', metricId: 'metric', value: 90, metadata: {},
      model: { id: 'model', name: 'Model', isOpenSource: false, architecture: 'ar-transformer' },
      metric: { id: 'metric', name: 'Accuracy' },
    };
    const scores = (hydrator as any).toMetricScores([
      { ...row, sourceMode: 'benchmark', obtainedAt: new Date('2026-10-23') },
      { ...row, sourceMode: 'harness', value: 70, obtainedAt: new Date('2026-10-22') },
      { ...row, sourceMode: 'harness', value: 60, obtainedAt: new Date('2026-10-21') },
    ]) as Array<{ sourceMode: string; score: number }>;
    expect(scores).toHaveLength(2);
    expect(scores.filter((score) => 'benchmark' === score.sourceMode)).toEqual([expect.objectContaining({ score: 90 })]);
    expect(scores.filter((score) => 'harness' === score.sourceMode)).toEqual([expect.objectContaining({ score: 70 })]);
  });
});
