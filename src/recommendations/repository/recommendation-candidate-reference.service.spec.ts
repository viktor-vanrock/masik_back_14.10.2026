import { Prisma } from '@/generated/prisma/client';
import { RecommendationCandidateReferenceService } from './recommendation-candidate-reference.service';

describe('RecommendationCandidateReferenceService', () => {
  const transaction = {
    catalogTestProjection: { findMany: jest.fn() },
    catalogBenchmarkProjection: { findMany: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps only projected Tests whose suite is active', async () => {
    const updatedAt = new Date('2026-09-14T00:00:00.000Z');
    transaction.catalogTestProjection.findMany.mockResolvedValue([
      {
        testId: 'active-test',
        benchmarkId: 'active-suite',
        sourceUpdatedAt: updatedAt,
      },
      {
        testId: 'orphan-test',
        benchmarkId: 'missing-suite',
        sourceUpdatedAt: updatedAt,
      },
    ]);
    transaction.catalogBenchmarkProjection.findMany.mockResolvedValue([
      { benchmarkId: 'active-suite' },
    ]);
    const service = targetService();

    await expect(
      service.findActiveVersions(
        transaction as unknown as Prisma.TransactionClient,
        ['active-test', 'orphan-test']
      )
    ).resolves.toEqual([{ id: 'active-test', sourceUpdatedAt: updatedAt }]);
  });

  it('does not query projections for an empty candidate set', async () => {
    await expect(
      targetService().findActiveVersions(
        transaction as unknown as Prisma.TransactionClient,
        []
      )
    ).resolves.toEqual([]);
    expect(transaction.catalogTestProjection.findMany).not.toHaveBeenCalled();
  });

});

function targetService(): RecommendationCandidateReferenceService {
  return new RecommendationCandidateReferenceService();
}
