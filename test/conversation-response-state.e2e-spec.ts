import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConversationsRepository } from '@/conversations/repository/conversations.repository';
import { messageResponseState } from '@/conversations/response-state';
import { PrismaService } from '@/prisma/prisma.service';
import { createE2eApplication } from './support/create-e2e-application';

describe('Persisted conversation response state (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repository: ConversationsRepository;
  const owner = randomUUID();
  let conversationId: string;

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
    repository = new ConversationsRepository(prisma);
    await prisma.user.create({ data: {
      id: owner, username: `response-${owner}`, email: `${owner}@example.test`,
      password: 'test-only-unused-hash', role: 'USER',
    } });
  });

  beforeEach(async () => {
    conversationId = (await repository.createConversation(owner)).id;
  });

  afterAll(async () => {
    await prisma.conversation.deleteMany({ where: { userId: owner } });
    await prisma.user.delete({ where: { id: owner } });
    await app.close();
  });

  function send(id: string = randomUUID(), content = 'Подготовьте задания') {
    return repository.createUserResponse({
      id, conversationId, userId: owner, role: 'user', kind: 'text', content,
    });
  }

  it('accepts simultaneous delivery of one request only once', async () => {
    const id = randomUUID();
    const outcomes = await Promise.all([send(id), send(id), send(id)]);
    expect(outcomes.filter((outcome) => outcome.created)).toHaveLength(1);
    expect(outcomes.every((outcome) => outcome.responseState.requestId === id)).toBe(true);
    expect(await prisma.message.count({ where: { conversationId } })).toBe(1);
  });

  it('rejects a different concurrent turn while the first reply is pending', async () => {
    const outcomes = await Promise.allSettled([send(), send()]);
    expect(outcomes.filter((outcome) => 'fulfilled' === outcome.status)).toHaveLength(1);
    expect(outcomes.filter((outcome) => 'rejected' === outcome.status)).toHaveLength(1);
    expect(await prisma.message.count({ where: { conversationId } })).toBe(1);
  });

  it('rejects another payload or owner for the same request ID', async () => {
    const accepted = await send();
    await expect(send(accepted.message.id, 'Другой текст')).rejects.toMatchObject({ status: 409 });
    await expect(repository.createUserResponse({
      id: accepted.message.id, conversationId, userId: 'another-owner',
      role: 'user', kind: 'text', content: accepted.message.content,
    })).rejects.toMatchObject({ status: 404 });
    expect(await prisma.message.count({ where: { conversationId } })).toBe(1);
  });

  it('stores a reply and settles its pending request together, then allows the next turn', async () => {
    const accepted = await send();
    const eventId = randomUUID();
    const reply = {
      id: eventId, conversationId, role: 'agent' as const, kind: 'text' as const,
      content: 'Уточните предметную область', response: { requestId: accepted.message.id, attempt: 1 },
    };
    expect((await repository.createMessage(reply))?.responseState?.status).toBe('responded');
    await repository.createMessage(reply);
    expect(await prisma.message.count({ where: { id: eventId } })).toBe(1);
    const stored = await prisma.message.findUniqueOrThrow({ where: { id: accepted.message.id } });
    expect(messageResponseState(stored)?.status).toBe('responded');
    expect((await send()).created).toBe(true);
  });

  it('persists question options and one idempotent selected answer without changing IDs or labels', async () => {
    const accepted = await send();
    const options = [{ id: 'accuracy', label: 'Улучшить точность' }, { id: 'speed', label: 'Скорость' }];
    const eventId = randomUUID();
    const question = { id: eventId, conversationId, role: 'agent' as const, kind: 'question' as const,
      content: 'Что проверяем?', options, response: { requestId: accepted.message.id, attempt: 1 } };
    await repository.createMessage(question);
    await repository.createMessage(question);
    const detail = await repository.findByIdWithMessages(conversationId, owner);
    expect(detail?.messages.find((message) => message.id === eventId)?.options).toEqual(options);
    expect(await prisma.message.count({ where: { id: eventId } })).toBe(1);
    const answer = { id: randomUUID(), conversationId, userId: owner, role: 'user' as const, kind: 'option' as const,
      optionId: options[0].id, content: options[0].label };
    const outcomes = await Promise.all([repository.createUserResponse(answer), repository.createUserResponse(answer)]);
    expect(outcomes.filter((outcome) => outcome.created)).toHaveLength(1);
    const stored = await prisma.message.findUniqueOrThrow({ where: { id: answer.id } });
    expect(stored).toMatchObject({ kind: 'option', optionId: 'accuracy', content: 'Улучшить точность' });
  });

  it('does not settle pending when the reply insert fails', async () => {
    const accepted = await send();
    const otherConversation = await repository.createConversation(owner);
    const conflictingEvent = await repository.createMessage({
      conversationId: otherConversation.id, role: 'agent', kind: 'text', content: 'Other conversation',
    });
    await expect(repository.createMessage({
      id: conflictingEvent!.id, conversationId, role: 'agent', kind: 'text', content: 'Conflicting event',
      response: { requestId: accepted.message.id, attempt: 1 },
    })).rejects.toThrow();
    const stored = await prisma.message.findUniqueOrThrow({ where: { id: accepted.message.id } });
    expect(messageResponseState(stored)?.status).toBe('pending');
    expect(await prisma.message.count({ where: { conversationId, role: 'agent' } })).toBe(0);
  });

  it('ignores stale attempts and only one concurrent terminal transition wins', async () => {
    const accepted = await send();
    expect(await repository.completeResponse(conversationId, accepted.message.id, 2, 'responded')).toBeNull();
    const outcomes = await Promise.all([
      repository.completeResponse(conversationId, accepted.message.id, 1, 'responded'),
      repository.completeResponse(conversationId, accepted.message.id, 1, 'failed', {
        code: 'TEST_FAILURE', message: 'Тестовый сбой', retryable: true,
      }),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(await repository.completeResponse(conversationId, accepted.message.id, 1, 'responded')).toBeNull();
  });

  async function fail(requestId: string, attempt = 1, retryable = true) {
    return repository.completeResponse(conversationId, requestId, attempt, 'failed', {
      code: 'TEST_FAILURE', message: 'Test failure', retryable,
    });
  }

  it('persists actual progress for reload, keeps intermediate speech pending, and clears it on terminal/retry', async () => {
    const accepted = await send();
    const id = accepted.message.id;
    const progress = { stage: 'compose' as const, message: 'Составляем бриф' };
    const updated = await repository.updateResponseProgress(conversationId, id, 1, progress);
    expect(updated).toMatchObject({ status: 'pending', progress });
    expect((await repository.findByIdWithMessages(conversationId, owner))?.messages
      .map(messageResponseState).find(Boolean)?.progress).toMatchObject(progress);
    await repository.createMessage({ conversationId, role: 'agent', kind: 'text', content: 'Начинаю подготовку',
      response: { requestId: id, attempt: 1, settle: false } });
    expect((await repository.findResponseState(conversationId, id))?.status).toBe('pending');
    await fail(id);
    expect((await repository.findResponseState(conversationId, id))?.progress).toBeUndefined();
    await repository.retryResponse(conversationId, owner, id, 1);
    expect((await repository.findResponseState(conversationId, id))?.progress).toBeUndefined();
    expect(await repository.updateResponseProgress(conversationId, id, 1, progress)).toBeNull();
    await repository.updateResponseProgress(conversationId, id, 2, { stage: 'save', message: 'Сохраняем бриф' });
    await repository.completeResponse(conversationId, id, 2, 'responded');
    expect(await repository.updateResponseProgress(conversationId, id, 2, progress)).toBeNull();
    expect((await repository.findResponseState(conversationId, id))?.progress).toBeUndefined();
  });

  it('does not reopen terminal state when progress races completion, and rejects deleted-chat progress', async () => {
    const accepted = await send();
    const id = accepted.message.id;
    await Promise.all([
      repository.updateResponseProgress(conversationId, id, 1, { stage: 'validate', message: 'Проверяем бриф' }),
      repository.completeResponse(conversationId, id, 1, 'responded'),
    ]);
    expect(await repository.findResponseState(conversationId, id)).toMatchObject({ status: 'responded' });
    expect((await repository.findResponseState(conversationId, id))?.progress).toBeUndefined();
    await repository.softDelete(conversationId, owner);
    await expect(repository.updateResponseProgress(conversationId, id, 1,
      { stage: 'save', message: 'Не сохранять' })).rejects.toMatchObject({ status: 404 });
  });

  it('starts only one concurrent retry and keeps the original user message', async () => {
    const accepted = await send();
    await fail(accepted.message.id);
    const attempts = await Promise.all(Array.from({ length: 3 }, () =>
      repository.retryResponse(conversationId, owner, accepted.message.id, 1)));
    expect(attempts.filter((attempt) => attempt.started)).toHaveLength(1);
    expect(attempts.every(({ responseState }) => 2 === responseState.attempt && 'pending' === responseState.status)).toBe(true);
    expect(await prisma.message.count({ where: { conversationId, role: 'user' } })).toBe(1);
    expect(await repository.completeResponse(conversationId, accepted.message.id, 1, 'responded')).toBeNull();
    expect((await repository.completeResponse(conversationId, accepted.message.id, 2, 'responded'))?.status).toBe('responded');
    expect((await repository.retryResponse(conversationId, owner, accepted.message.id, 1)).started).toBe(false);
  });

  it('requires the owner and a confirmed retryable failure', async () => {
    const accepted = await send();
    await expect(repository.retryResponse(conversationId, 'other-owner', accepted.message.id, 1)).rejects.toMatchObject({ status: 404 });
    await expect(repository.retryResponse(conversationId, owner, accepted.message.id, 1)).rejects.toMatchObject({ status: 409 });
    await fail(accepted.message.id, 1, false);
    await expect(repository.retryResponse(conversationId, owner, accepted.message.id, 1)).rejects.toMatchObject({ status: 409 });
    expect((await repository.findResponseState(conversationId, accepted.message.id))?.attempt).toBe(1);
  });

  it('rejects retrying an older user message after a new turn was accepted', async () => {
    const accepted = await send();
    await fail(accepted.message.id);
    await send();
    await expect(repository.retryResponse(conversationId, owner, accepted.message.id, 1)).rejects.toMatchObject({ status: 409 });
    expect((await repository.findResponseState(conversationId, accepted.message.id))?.status).toBe('failed');
  });

  it('requires a new explicit retry after the next attempt fails', async () => {
    const accepted = await send();
    await fail(accepted.message.id);
    await repository.retryResponse(conversationId, owner, accepted.message.id, 1);
    await fail(accepted.message.id, 2);
    expect((await repository.retryResponse(conversationId, owner, accepted.message.id, 1)).started).toBe(false);
    const third = await repository.retryResponse(conversationId, owner, accepted.message.id, 2);
    expect(third).toMatchObject({ started: true, responseState: { attempt: 3, status: 'pending' } });
    expect(await prisma.message.count({ where: { conversationId, role: 'user' } })).toBe(1);
  });

  it('atomically rejects late replies from a failed or superseded attempt before insertion', async () => {
    const accepted = await send();
    const reply = { conversationId, role: 'agent' as const, kind: 'text' as const, content: 'Stale reply',
      response: { requestId: accepted.message.id, attempt: 1 } };
    await fail(accepted.message.id);
    expect(await repository.createMessage(reply)).toBeNull();
    await repository.retryResponse(conversationId, owner, accepted.message.id, 1);
    expect(await repository.createMessage(reply)).toBeNull();
    expect(await prisma.message.count({ where: { conversationId, role: 'agent' } })).toBe(0);
    expect((await repository.findResponseState(conversationId, accepted.message.id))?.status).toBe('pending');
    await repository.createMessage({ ...reply, content: 'Current reply', response: { ...reply.response, attempt: 2 } });
    expect((await repository.findResponseState(conversationId, accepted.message.id))?.status).toBe('responded');
  });

  it('persists a workflow error once without changing an answered turn or a newer pending turn', async () => {
    const answered = await send();
    await repository.completeResponse(conversationId, answered.message.id, 1, 'responded');
    const pending = await send();
    const error = { id: randomUUID(), conversationId, role: 'agent' as const, kind: 'text' as const,
      content: 'Не удалось завершить ответ. Уже полученные результаты сохранены.',
      options: { kind: 'workflow_error', requestId: answered.message.id, attempt: 1 },
      response: { requestId: answered.message.id, attempt: 1, settle: false } };
    await repository.createMessage(error);
    await repository.createMessage(error);
    const detail = await repository.findByIdWithMessages(conversationId, owner);
    expect(detail?.messages.filter((message) => message.id === error.id)).toHaveLength(1);
    expect((await repository.findResponseState(conversationId, answered.message.id))?.status).toBe('responded');
    expect((await repository.findResponseState(conversationId, pending.message.id))?.status).toBe('pending');
  });
});
