import { PrismaService } from '@/prisma/prisma.service';
import { OutboxRepository } from '../outbox.repository';

describe('OutboxRepository', () => {
  const queryRaw = jest.fn();
  const updateMany = jest.fn();
  const prisma = {
    $queryRaw: queryRaw,
    outboxMessage: { updateMany },
  } as unknown as PrismaService;
  const repository = new OutboxRepository(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('atomically leases only head-of-line messages in deterministic order', async () => {
    const availableBefore = new Date('2026-09-06T10:00:00Z');
    const row = {
      id: 'event-id',
      claimedAt: availableBefore,
      claimToken: '11111111-1111-4111-8111-111111111111',
    };
    queryRaw.mockResolvedValue([row]);

    const claimed = await repository.findPending({ availableBefore, limit: 50 });
    expect(claimed).toEqual([row]);
    const leaseExpiredBefore = new Date(availableBefore.getTime() - 30_000);
    const query = queryRaw.mock.calls[0][0] as {
      sql: string;
      values: unknown[];
    };
    expect(query.values).toEqual(
      expect.arrayContaining([availableBefore, leaseExpiredBefore, 50])
    );
    expect(query.sql).toContain('NOT EXISTS');
  });

  it('marks an event published only while it is still pending', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const publishedAt = new Date('2026-09-06T10:00:00Z');
    const claimToken = '11111111-1111-4111-8111-111111111111';

    await expect(
      repository.markPublished({ id: 'event-id', claimToken, publishedAt })
    ).resolves.toBe(true);
    await expect(
      repository.markPublished({ id: 'event-id', claimToken, publishedAt })
    ).resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'event-id', publishedAt: null, claimToken },
      data: {
        publishedAt,
        lastError: null,
        claimedAt: null,
        claimToken: null,
      },
    });
  });

  it('atomically increments retry metadata only for a pending event', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const availableAt = new Date('2026-09-06T10:01:00Z');
    const params = {
      id: 'event-id',
      claimToken: '11111111-1111-4111-8111-111111111111',
      availableAt,
      lastError: 'Kafka unavailable',
    };

    await expect(repository.markFailed(params)).resolves.toBe(true);
    await expect(repository.markFailed(params)).resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'event-id',
        publishedAt: null,
        claimToken: params.claimToken,
      },
      data: {
        attempts: { increment: 1 },
        availableAt,
        lastError: 'Kafka unavailable',
        claimedAt: null,
        claimToken: null,
      },
    });
  });
});
