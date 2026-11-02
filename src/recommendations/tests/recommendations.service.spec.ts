import {
  Recommendation,
  RecommendationStatus,
} from '@/generated/prisma/client';
import { RecommendationsService } from '../recommendations.service';
import { IRecommendationsRepository } from '../repository/recommendations.repository.interface';

describe('RecommendationsService status transitions', () => {
  const findById = jest.fn();
  const updatePendingStatus = jest.fn();
  const repository = {
    findById,
    updatePendingStatus,
  } as unknown as jest.Mocked<IRecommendationsRepository>;
  const service = new RecommendationsService(repository);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('transitions pending recommendation with compare-and-set', async () => {
    const pending = recommendation();
    const selected = recommendation({
      status: RecommendationStatus.selected,
    });
    findById.mockResolvedValue(pending);
    updatePendingStatus.mockResolvedValue(selected);

    await expect(
      service.updateStatus({
        id: pending.id,
        status: RecommendationStatus.selected,
      })
    ).resolves.toEqual({ recommendation: selected, transitioned: true });

    expect(updatePendingStatus).toHaveBeenCalledWith(
      pending.id,
      RecommendationStatus.selected
    );
  });

  it('treats a repeated identical action as idempotent', async () => {
    const selected = recommendation({
      status: RecommendationStatus.selected,
    });
    findById.mockResolvedValue(selected);

    await expect(
      service.updateStatus({
        id: selected.id,
        status: RecommendationStatus.selected,
      })
    ).resolves.toEqual({ recommendation: selected, transitioned: false });

    expect(updatePendingStatus).not.toHaveBeenCalled();
  });

  it('recognizes the same action that lost a concurrent race', async () => {
    const pending = recommendation();
    const selected = recommendation({
      status: RecommendationStatus.selected,
    });
    findById
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(selected);
    updatePendingStatus.mockResolvedValue(null);

    await expect(
      service.updateStatus({
        id: pending.id,
        status: RecommendationStatus.selected,
      })
    ).resolves.toEqual({ recommendation: selected, transitioned: false });
  });

  it('rejects the opposite action after a concurrent race', async () => {
    const pending = recommendation();
    const rejected = recommendation({
      status: RecommendationStatus.rejected,
    });
    findById
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(rejected);
    updatePendingStatus.mockResolvedValue(null);

    await expect(
      service.updateStatus({
        id: pending.id,
        status: RecommendationStatus.selected,
      })
    ).rejects.toThrow(`Recommendation "${pending.id}" is already rejected`);
  });

  it('does not reveal whether a missing recommendation belongs to another user', async () => {
    findById.mockResolvedValue(null);

    await expect(
      service.updateStatus({
        id: 'missing-id',
        status: RecommendationStatus.selected,
      })
    ).rejects.toThrow('Recommendation "missing-id" was not found');
  });
});

function recommendation(
  overrides: Partial<Recommendation> = {}
): Recommendation {
  const now = new Date('2026-09-06T10:00:00.000Z');
  return {
    id: '10000000-0000-4000-8000-000000000001',
    conversationId: '20000000-0000-4000-8000-000000000001',
    testId: 'test-id',
    status: RecommendationStatus.pending,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
