import { PrismaService } from '@/prisma/prisma.service';
import { ConversationsRepository } from '../repository/conversations.repository';

describe('Factory outbox message persistence', () => {
  const upsert = jest.fn();
  const create = jest.fn();
  const repository = new ConversationsRepository({ message: { upsert, create } } as unknown as PrismaService);
  const input = { id: '11111111-1111-4111-8111-111111111111',
    conversationId: '22222222-2222-4222-8222-222222222222', role: 'agent' as const,
    kind: 'text' as const, content: 'Найден тест',
    options: { kind: 'recommendations', benchmarks: [{ testId: 'math' }] },
  };

  beforeEach(() => { jest.resetAllMocks(); });

  it('uses event ID and conversation scope to return an existing message without altering it', async () => {
    const persisted = { ...input, createdAt: new Date(0) };
    upsert.mockResolvedValue(persisted);
    expect(await repository.createMessage(input)).toBe(persisted);
    expect(await repository.createMessage(input)).toBe(persisted);
    expect(upsert).toHaveBeenCalledWith({
      where: { id: input.id, conversationId: input.conversationId },
      create: expect.objectContaining(input), update: {},
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps automatic IDs for legacy messages without eventId', async () => {
    const { id, ...legacy } = input;
    void id;
    await repository.createMessage(legacy);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining(legacy) });
    expect(upsert).not.toHaveBeenCalled();
  });
});
