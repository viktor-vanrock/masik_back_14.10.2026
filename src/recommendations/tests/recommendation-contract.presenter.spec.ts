import {
  presentRecommendationResultPayload,
  presentTestTargetObject,
} from '../recommendation-contract.presenter';

describe('Recommendation contract presenter', () => {
  it('renames a legacy BenchmarkTest identifier without changing ranking data', () => {
    expect(
      presentRecommendationResultPayload([
        {
          benchmarkId: 'test-id',
          rank: 1,
          score: 0.9,
          rerankScore: 0.95,
          sourceUpdatedAt: '2026-09-07T10:00:00.000Z',
        },
      ])
    ).toEqual([
      {
        testId: 'test-id',
        rank: 1,
        score: 0.9,
        rerankScore: 0.95,
        sourceUpdatedAt: '2026-09-07T10:00:00.000Z',
      },
    ]);
  });

  it('keeps canonical payloads canonical when both keys are present', () => {
    expect(
      presentRecommendationResultPayload([
        { benchmarkId: 'legacy-id', testId: 'canonical-id', rank: 1 },
      ])
    ).toEqual([{ testId: 'canonical-id', rank: 1 }]);
  });

  it.each([null, { unexpected: true }, 'invalid payload'])(
    'does not reinterpret a non-array payload: %p',
    (payload) => {
      expect(presentRecommendationResultPayload(payload)).toEqual(payload);
    }
  );

  it('normalizes legacy agent message options', () => {
    expect(
      presentTestTargetObject({ benchmarkId: 'test-id', status: 'done' })
    ).toEqual({ testId: 'test-id', status: 'done' });
  });

  it('leaves non-object array entries intact and removes an invalid legacy key', () => {
    expect(
      presentRecommendationResultPayload([
        null,
        'unexpected',
        { benchmarkId: 42, rank: 1 },
      ])
    ).toEqual([null, 'unexpected', { rank: 1 }]);
  });
});
