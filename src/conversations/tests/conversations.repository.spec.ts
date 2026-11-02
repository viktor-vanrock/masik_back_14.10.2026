import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '@/prisma/prisma.service';
import { ConversationsRepository } from '../repository/conversations.repository';

describe('Factory outbox message persistence', () => {
  const create = jest.fn();
  const createManyAndReturn = jest.fn();
  const findUniqueOrThrow = jest.fn();
  const update = jest.fn();
  const transaction = jest.fn();
  const queryRaw = jest.fn();
  const findFirst = jest.fn();
  const findUnique = jest.fn();
  const updateMany = jest.fn();
  const client = { $queryRaw: queryRaw,
    message: { create, createManyAndReturn, findUniqueOrThrow, findFirst, findUnique, updateMany }, conversation: { update } };
  const repository = new ConversationsRepository({ $transaction: transaction } as unknown as PrismaService);
  const input = { id: '11111111-1111-4111-8111-111111111111',
    conversationId: '22222222-2222-4222-8222-222222222222', role: 'agent' as const,
    kind: 'text' as const, content: 'Найден тест',
    options: { kind: 'recommendations', benchmarks: [{ testId: 'math' }] },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    queryRaw.mockResolvedValue([{ id: input.conversationId, userId: 'owner', role: 'USER', status: 'active', agentContext: null }]);
    transaction.mockImplementation((callback) => callback(client));
  });

  it('touches the conversation once for a new event and leaves it unchanged on replay', async () => {
    const persisted = { ...input, createdAt: new Date(0) };
    createManyAndReturn.mockResolvedValueOnce([persisted]).mockResolvedValueOnce([]);
    findUniqueOrThrow.mockResolvedValue(persisted);
    expect(await repository.createMessage(input)).toBe(persisted);
    expect(await repository.createMessage(input)).toBe(persisted);
    expect(createManyAndReturn).toHaveBeenCalledWith({
      data: expect.objectContaining(input), skipDuplicates: true,
    });
    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: input.id, conversationId: input.conversationId },
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: input.conversationId }, data: { updatedAt: expect.any(Date) },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('touches the conversation for a legacy message with an automatic ID', async () => {
    const { id, ...legacy } = input;
    void id;
    const persisted = { ...legacy, id: 'generated-id' };
    create.mockResolvedValue(persisted);
    expect(await repository.createMessage(legacy)).toBe(persisted);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining(legacy) });
    expect(create.mock.calls[0][0].data).not.toHaveProperty('id');
    expect(update).toHaveBeenCalledWith({
      where: { id: input.conversationId }, data: { updatedAt: expect.any(Date) },
    });
    expect(createManyAndReturn).not.toHaveBeenCalled();
  });

  it('does not touch the conversation when a new message cannot be saved', async () => {
    const error = new Error('Write failed');
    createManyAndReturn.mockRejectedValue(error);
    await expect(repository.createMessage(input)).rejects.toBe(error);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a duplicate event ID from another conversation without touching it', async () => {
    const error = new Error('Message not found in this conversation');
    createManyAndReturn.mockResolvedValue([]);
    findUniqueOrThrow.mockRejectedValue(error);
    await expect(repository.createMessage(input)).rejects.toBe(error);
    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: input.id, conversationId: input.conversationId },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('saves a reply, activity and response state in the same transaction', async () => {
    const state = { status: 'pending', attempt: 1, updatedAt: new Date(0).toISOString(), error: null };
    const user = { id: 'request', conversationId: input.conversationId, role: 'user', options: { responseState: state } };
    findFirst.mockResolvedValue(user);
    findUnique.mockResolvedValue(user);
    updateMany.mockResolvedValue({ count: 1 });
    createManyAndReturn.mockResolvedValue([input]);

    await expect(repository.createMessage({ ...input, response: { requestId: user.id, attempt: 1 } }))
      .resolves.toMatchObject({ ...input, responseState: { status: 'responded', attempt: 1 } });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith({ where: { id: input.conversationId }, data: { updatedAt: expect.any(Date) } });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { options: {
      responseState: expect.objectContaining({ status: 'responded' }),
    } } }));
  });

  it('rejects a stale reply before inserting a message or changing activity', async () => {
    findFirst.mockResolvedValue({ id: 'request', role: 'user', options: {
      responseState: { status: 'pending', attempt: 2, updatedAt: new Date(0).toISOString() },
    } });
    await expect(repository.createMessage({ ...input, response: { requestId: 'request', attempt: 1 } })).resolves.toBeNull();
    expect(createManyAndReturn).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('touches activity for a new user request but not its replay', async () => {
    const request = { ...input, role: 'user' as const, userId: 'owner' };
    queryRaw.mockResolvedValue([{ id: input.conversationId }]);
    findUnique.mockResolvedValueOnce(null);
    findFirst.mockResolvedValue(null);
    create.mockImplementation(async ({ data }) => data);
    const saved = await repository.createUserResponse(request);
    expect(saved).toMatchObject({ created: true, responseState: { status: 'pending' } });
    expect(update).toHaveBeenCalledWith({ where: { id: input.conversationId }, data: { updatedAt: expect.any(Date) } });
    findUnique.mockResolvedValueOnce(saved.message);
    await expect(repository.createUserResponse(request)).resolves.toMatchObject({ created: false });
    expect(update).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each(['text', 'option'] as const)('denies a %s turn in a completed DEMO chat before any message write', async (kind) => {
    queryRaw.mockResolvedValue([{ id: input.conversationId, userId: 'owner', role: 'DEMO', status: 'completed', agentContext: null }]);
    await expect(repository.createUserResponse({ ...input, role: 'user', userId: 'owner', kind }))
      .rejects.toMatchObject({ status: 409 });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects retries and late agent output in a completed DEMO chat', async () => {
    queryRaw.mockResolvedValue([{ id: input.conversationId, userId: 'owner', role: 'DEMO', status: 'completed', agentContext: null }]);
    await expect(repository.retryResponse(input.conversationId, 'owner', input.id, 1)).rejects.toMatchObject({ status: 409 });
    expect(await repository.createMessage(input)).toBeNull();
    expect(await repository.createMessage({ ...input, kind: 'result', options: { status: 'brief_ready' } })).toBeNull();
    expect(createManyAndReturn).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('protects completed DEMO context while permitting transport acknowledgement', async () => {
    const previous = { requirements: { language: 'ru', goal: 'Налоги' }, ready: true, messages: [], pending_output: ['sent'] };
    queryRaw.mockResolvedValue([{ id: input.conversationId, userId: 'owner', role: 'DEMO', status: 'completed', agentContext: previous }]);
    await expect(repository.updateAgentContext(input.conversationId, { ...previous, requirements: { language: 'en' } }))
      .rejects.toMatchObject({ status: 409 });
    expect(update).not.toHaveBeenCalled();
    await repository.updateAgentContext(input.conversationId, {
      ...previous, requirements: { goal: 'Налоги', language: 'ru' }, pending_output: [], revision: 2,
    });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('persists only the exact ready event in the frozen Brief outbox', async () => {
    const context = JSON.parse(readFileSync(resolve('test/fixtures/demo-prepared-context.json'), 'utf8'));
    const requestId = '33333333-3333-4333-8333-333333333333';
    const ready = { ...input, kind: 'result' as const, content: 'Бриф сохранён', options: { status: 'brief_ready' },
      response: { requestId, attempt: 1 } };
    context.pending_output = [{ eventId: input.id, requestId, attempt: 1, content: { label: ready.content, status: 'brief_ready' } }];
    queryRaw.mockResolvedValue([{ id: input.conversationId, userId: 'owner', role: 'DEMO', status: 'active', agentContext: context }]);
    const user = { id: requestId, role: 'user', options: { responseState: { status: 'pending', attempt: 1, updatedAt: new Date(0).toISOString(), error: null } } };
    findFirst.mockResolvedValue(user);
    findUnique.mockResolvedValue(user);
    updateMany.mockResolvedValue({ count: 1 });
    createManyAndReturn.mockResolvedValue([ready]);
    expect(await repository.createMessage({ ...ready, id: 'not-in-outbox' })).toBeNull();
    expect(await repository.createMessage({ ...ready, response: { requestId, attempt: 2 } })).toBeNull();
    expect(createManyAndReturn).not.toHaveBeenCalled();
    expect(await repository.createMessage(ready)).toMatchObject({ id: ready.id });
    expect(createManyAndReturn).toHaveBeenCalledTimes(1);
  });
});
