import {
  ConversationStatus,
  MessageKind,
  MessageRole,
  Prisma,
} from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { conversationFullInclude } from '../types';
import { ConversationsRepository } from './conversations.repository';

describe('ConversationsRepository', () => {
  const conversation = {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const message = {
    create: jest.fn(),
  };
  const transaction = jest.fn();
  const prisma = {
    conversation,
    message,
    $transaction: transaction,
  } as unknown as PrismaService;
  const repository = new ConversationsRepository(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    transaction.mockImplementation(
      async (
        action:
          | Promise<unknown>[]
          | ((client: {
            conversation: typeof conversation;
            message: typeof message;
          }) => Promise<unknown>)
      ) =>
        'function' === typeof action
          ? action({ conversation, message })
          : Promise.all(action)
    );
  });

  it('uses the same owner filter for the page and its total', async () => {
    const rows = [{ id: 'conversation-id', userId: 'owner-id' }];
    conversation.findMany.mockResolvedValue(rows);
    conversation.count.mockResolvedValue(1);

    await expect(
      repository.findAll({ page: 3, limit: 10 }, 'owner-id')
    ).resolves.toEqual({ data: rows, total: 1 });

    expect(conversation.findMany).toHaveBeenCalledWith({
      where: { userId: 'owner-id' },
      orderBy: [{ pinnedDate: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }, { id: 'desc' }],
      skip: 20,
      take: 10,
    });
    expect(conversation.count).toHaveBeenCalledWith({
      where: { userId: 'owner-id' },
    });
  });

  it('loads the next history page without repeating pins or archived chats', async () => {
    conversation.findMany
      .mockResolvedValueOnce([{ id: 'history' }]);
    conversation.count.mockResolvedValue(41);

    await expect(repository.findSidebar(2, 'owner-id')).resolves.toEqual({
      pinned: [],
      data: [{ id: 'history' }],
      total: 41,
      pageSize: 20,
    });
    expect(conversation.findMany).toHaveBeenCalledTimes(1);
    expect(conversation.findMany).toHaveBeenCalledWith({
      where: { userId: 'owner-id', isArchived: false, pinnedDate: null },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: 20,
      take: 20,
    });
    expect(conversation.count).toHaveBeenCalledWith({
      where: { userId: 'owner-id', isArchived: false, pinnedDate: null },
    });
  });

  it('returns every active pin with the first history page', async () => {
    conversation.findMany
      .mockResolvedValueOnce([{ id: 'history' }])
      .mockResolvedValueOnce([{ id: 'pin' }]);
    conversation.count.mockResolvedValue(21);
    await expect(repository.findSidebar(1, 'owner-id')).resolves.toEqual({
      pinned: [{ id: 'pin' }], data: [{ id: 'history' }], total: 21,
      pageSize: 20,
    });
    expect(conversation.findMany).toHaveBeenCalledWith({
      where: { userId: 'owner-id', isArchived: false, pinnedDate: { not: null } },
      orderBy: [{ pinnedDate: 'desc' }, { id: 'desc' }],
    });
  });

  it('paginates archived chats for the owner', async () => {
    conversation.findMany.mockResolvedValue([{ id: 'archive' }]);
    conversation.count.mockResolvedValue(25);
    await expect(repository.findArchived(2, 'owner-id')).resolves.toEqual({
      data: [{ id: 'archive' }], total: 25, pageSize: 20,
    });
    expect(conversation.findMany).toHaveBeenCalledWith({
      where: { userId: 'owner-id', isArchived: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: 20,
      take: 20,
    });
    expect(conversation.count).toHaveBeenCalledWith({ where: { userId: 'owner-id', isArchived: true } });
  });

  it('queries conversation details by both id and owner', async () => {
    conversation.findFirst.mockResolvedValue(null);

    await expect(
      repository.findByIdWithMessages('conversation-id', 'owner-id')
    ).resolves.toBeNull();

    expect(conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'conversation-id', userId: 'owner-id' },
      include: conversationFullInclude,
    });
  });

  it('queries a conversation by both id and owner', async () => {
    conversation.findFirst.mockResolvedValue(null);

    await repository.findById('conversation-id', 'owner-id');

    expect(conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'conversation-id', userId: 'owner-id' },
    });
  });

  it('rejects a missing owner ID before querying conversations', async () => {
    const missingOwner = undefined as unknown as string;

    await expect(repository.findAll({ page: 1, limit: 20 }, missingOwner))
      .rejects.toThrow('Conversation owner ID is required');
    await expect(repository.findById('conversation-id', missingOwner))
      .rejects.toThrow('Conversation owner ID is required');
    await expect(repository.findByIdWithMessages('conversation-id', missingOwner))
      .rejects.toThrow('Conversation owner ID is required');

    expect(conversation.findMany).not.toHaveBeenCalled();
    expect(conversation.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['omitted', undefined],
    ['null', null],
  ])('stores %s message options as database JSON null', async (_label, options) => {
    message.create.mockResolvedValue({ id: 'message-id' });

    await repository.createMessage({
      conversationId: 'conversation-id',
      role: MessageRole.agent,
      kind: MessageKind.question,
      content: 'Choose one',
      options,
    });

    expect(message.create).toHaveBeenCalledWith({
      data: {
        conversationId: 'conversation-id',
        role: MessageRole.agent,
        kind: MessageKind.question,
        content: 'Choose one',
        optionId: null,
        options: Prisma.JsonNull,
        interviewState: Prisma.DbNull,
      },
    });
  });

  it('preserves message options and an explicit selected option', async () => {
    const options = [{ id: 'a', label: 'Option A' }];
    message.create.mockResolvedValue({ id: 'message-id' });

    await repository.createMessage({
      conversationId: 'conversation-id',
      role: MessageRole.user,
      kind: MessageKind.option,
      content: 'Option A',
      optionId: 'a',
      options,
    });

    expect(message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ optionId: 'a', options }),
    });
  });

  it('updates status by conversation id', async () => {
    conversation.update.mockResolvedValue({ id: 'conversation-id' });

    await repository.updateStatus(
      'conversation-id',
      ConversationStatus.completed
    );

    expect(conversation.update).toHaveBeenCalledWith({
      where: { id: 'conversation-id' },
      data: { status: ConversationStatus.completed },
    });
  });

  it('atomically completes a conversation and records selection once', async () => {
    conversation.updateMany.mockResolvedValue({ count: 1 });
    message.create.mockResolvedValue({ id: 'message-id' });

    await expect(
      repository.completeWithRecommendation('conversation-id', 'benchmark-id')
    ).resolves.toBe(true);

    expect(conversation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'conversation-id',
        status: { not: ConversationStatus.completed },
      },
      data: { status: ConversationStatus.completed },
    });
    expect(message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: 'conversation-id',
        kind: 'recommendation_selected',
        content: 'benchmark-id',
      }),
    });
  });

  it('does not duplicate selection after the conversation is completed', async () => {
    conversation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      repository.completeWithRecommendation('conversation-id', 'benchmark-id')
    ).resolves.toBe(false);

    expect(message.create).not.toHaveBeenCalled();
  });

  it('atomically claims benchmark creation and records one rejection', async () => {
    conversation.updateMany.mockResolvedValue({ count: 1 });
    message.create.mockResolvedValue({ id: 'message-id' });

    await expect(
      repository.beginBenchmarkCreation(
        'conversation-id',
        null,
        'benchmark-id'
      )
    ).resolves.toBe(true);

    expect(conversation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'conversation-id',
        intent: null,
        status: { not: ConversationStatus.completed },
      },
      data: {
        intent: 'create_new',
        status: ConversationStatus.active,
      },
    });
    expect(message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'recommendation_rejected',
        content: 'benchmark-id',
      }),
    });
  });
});
