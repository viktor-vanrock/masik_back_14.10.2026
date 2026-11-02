import { RecommendationStatus } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { RecommendationsRepository } from './recommendations.repository';

describe('RecommendationsRepository transitions', () => {
  const recommendation = {
    updateMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  };
  const transaction = jest.fn();
  const queryRaw = jest.fn();
  const prisma = {
    recommendation,
    $transaction: transaction,
  } as unknown as PrismaService;
  const repository = new RecommendationsRepository(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    queryRaw.mockResolvedValue([{ id: 'conversation-id', role: 'USER', status: 'active', agentContext: null }]);
    recommendation.findUnique.mockResolvedValue({ conversationId: 'conversation-id' });
    transaction.mockImplementation(
      async (action: (client: { recommendation: typeof recommendation }) => Promise<unknown>) =>
        action({ recommendation, $queryRaw: queryRaw } as never)
    );
  });

  it('updates only a pending row and returns the winner', async () => {
    const selected = { id: 'recommendation-id', status: 'selected' };
    recommendation.updateMany.mockResolvedValue({ count: 1 });
    recommendation.findUniqueOrThrow.mockResolvedValue(selected);

    await expect(
      repository.updatePendingStatus(
        'recommendation-id',
        RecommendationStatus.selected
      )
    ).resolves.toBe(selected);

    expect(recommendation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'recommendation-id',
        status: RecommendationStatus.pending,
      },
      data: { status: RecommendationStatus.selected },
    });
  });

  it('returns null without reading when another action already won', async () => {
    recommendation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      repository.updatePendingStatus(
        'recommendation-id',
        RecommendationStatus.rejected
      )
    ).resolves.toBeNull();

    expect(recommendation.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('looks up a recommendation only within the current user\'s conversation', async () => {
    recommendation.findFirst.mockResolvedValue(null);

    await expect(
      repository.findByIdForUser('recommendation-id', 'staff-user-id')
    ).resolves.toBeNull();

    expect(recommendation.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'recommendation-id',
        conversation: { userId: 'staff-user-id', isDeleted: false },
      },
    });
  });
});
