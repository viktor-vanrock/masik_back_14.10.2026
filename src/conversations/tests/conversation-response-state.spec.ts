import { AgentMessageType } from '@/common/enums/agentMessageType.enum';
import { Role } from '@/common/enums/role.enum';
import { HypothesesService } from '@/hypotheses/hypotheses.service';
import { RecommendationRequestsService } from '@/recommendations/recommendation-requests.service';
import { RecommendationsService } from '@/recommendations/recommendations.service';
import { ConversationsService } from '../conversations.service';
import { IConversationsRepository } from '../repository/conversations.repository.interface';
import type { ConversationResponseState } from '../response-state';
import type { AgentMessagePayload } from '../types';

const conversationId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const response = (status: ConversationResponseState['status'] = 'pending'): ConversationResponseState => ({
  requestId, userMessageId: requestId, status, attempt: 1, error: null, updatedAt: '2026-10-29T00:00:00.000Z',
});

describe('Ordinary conversation response lifecycle', () => {
  function setup(status: ConversationResponseState['status'] = 'pending') {
    const message = { id: requestId, role: 'user', kind: 'text', content: 'Вопрос',
      createdAt: new Date(), options: { responseState: response(status) } };
    const conversation = { id: conversationId, userId: 'owner', status: 'active', intent: 'create_new',
      messages: [message], recommendations: [], recommendationRequests: [] };
    const repository = {
      isFrozen: jest.fn().mockResolvedValue(false),
      findById: jest.fn().mockResolvedValue(conversation),
      findByIdWithMessages: jest.fn().mockResolvedValue(conversation),
      createUserResponse: jest.fn().mockResolvedValue({ message, responseState: response(status), created: true }),
      createMessage: jest.fn().mockImplementation(async (input) => ({ ...input, id: 'answer', responseState: response('responded') })),
      completeResponse: jest.fn().mockResolvedValue(response('failed')),
      findResponseState: jest.fn().mockResolvedValue(response(status)),
      updateResponseProgress: jest.fn().mockImplementation(async (_id, _request, _attempt, progress) => ({ ...response(),
        progress: { ...progress, updatedAt: '2026-11-02T00:00:00.000Z' } })),
      retryResponse: jest.fn().mockResolvedValue({ responseState: { ...response(), attempt: 2 }, started: true }),
    };
    let listener!: (payload: AgentMessagePayload) => void;
    const agent = { connect: jest.fn(), close: jest.fn(), send: jest.fn(),
      onMessage: jest.fn((_id: string, callback: typeof listener) => { listener = callback; }) };
    const createGeneration = jest.fn();
    const createMany = jest.fn();
    const service = new ConversationsService(repository as unknown as IConversationsRepository, agent,
      {} as RecommendationRequestsService, { createGeneration } as unknown as HypothesesService,
      { createMany } as unknown as RecommendationsService);
    const onAgent = jest.fn();
    const onResponseState = jest.fn();
    const params = { conversationId, userId: 'owner', onAgent, onResponseState };
    return { repository, agent, service, onAgent, onResponseState, params, message, createGeneration, createMany,
      emit: (payload: AgentMessagePayload) => listener(payload) };
  }

  it('sends a new saved request once and excludes it from the readonly init history', async () => {
    const h = setup();
    const params = { ...h.params, kind: 'text' as const, value: 'Вопрос', requestId };
    await h.service.sendUserMessage(params);
    expect(h.agent.send.mock.calls).toEqual([
      [conversationId, { type: 'init', conversationId, intent: 'create_new', history: [], resume: false }],
      [conversationId, { type: 'message', content: { kind: 'text', label: 'Вопрос' }, requestId, attempt: 1 }],
    ]);
    expect(h.onResponseState).toHaveBeenCalledWith({ conversationId, responseState: response() });
    h.repository.createUserResponse.mockResolvedValueOnce({ message: h.message, responseState: response(), created: false });
    await h.service.sendUserMessage(params);
    expect(h.agent.send).toHaveBeenCalledTimes(2);
    await h.service.onModuleDestroy();
  });

  it('opening a failed conversation does not rerun the failed turn', async () => {
    const h = setup('failed');
    await h.service.startChat(h.params);
    expect(h.agent.connect).not.toHaveBeenCalled();
    expect(h.agent.send).not.toHaveBeenCalled();
  });

  it('opening an interrupted pending conversation only requests readonly replay', async () => {
    const h = setup();
    await h.service.startChat(h.params);
    expect(h.agent.send).toHaveBeenCalledWith(conversationId, expect.objectContaining({ type: 'init', resume: false }));
    expect(h.repository.completeResponse).not.toHaveBeenCalled();
    await h.service.onModuleDestroy();
  });

  it('exposes current response state separately from message options', async () => {
    const h = setup('failed');
    const detail = await h.service.findByIdWithMessages(conversationId, { id: 'owner', username: 'owner', role: Role.User });
    expect(detail.responseState).toEqual(response('failed'));
    expect(detail.messages[0].options).toBeNull();
    expect(detail.messages[0].content).toBe('Вопрос');
  });

  it('persists a meaningful reply together with its response state before notifying the browser', async () => {
    const h = setup();
    await h.service.startChat(h.params);
    h.emit({ type: AgentMessageType.Message, isFinal: false, requestId, attempt: 1,
      content: { kind: 'text', label: 'Ответ' } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.repository.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId, role: 'agent', content: 'Ответ', response: { requestId, attempt: 1 },
    }));
    expect(h.onResponseState).toHaveBeenCalledWith({ conversationId, responseState: response('responded') });
    expect(h.onResponseState.mock.invocationCallOrder[0]).toBeLessThan(h.onAgent.mock.invocationCallOrder[0]);
    await h.service.onModuleDestroy();
  });

  it('keeps intermediate speech pending and settles only the final reply', async () => {
    const h = setup();
    h.repository.createMessage.mockImplementation(async (input) => ({ ...input, id: 'answer',
      ...(false !== input.response?.settle ? { responseState: response('responded') } : {}),
    }));
    await h.service.startChat(h.params);
    h.emit({ type: AgentMessageType.Message, isFinal: false, turnComplete: false, requestId, attempt: 1,
      content: { kind: 'text', label: 'Требования собраны, подготовлю Brief' } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.repository.createMessage.mock.calls[0][0].response).toEqual({ requestId, attempt: 1, settle: false });
    expect(h.onResponseState).not.toHaveBeenCalled();
    expect(h.onAgent).toHaveBeenCalledWith(expect.objectContaining({ turnComplete: false }));
    h.emit({ type: AgentMessageType.Message, isFinal: false, turnComplete: true, requestId, attempt: 1,
      content: { kind: 'text', label: 'Уточните задачу' } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.onResponseState).toHaveBeenCalledWith({ conversationId, responseState: response('responded') });
    await h.service.onModuleDestroy();
  });

  it('persists confirmed stages before notifying subscribers and drops a lost atomic update', async () => {
    const h = setup();
    await h.service.startChat(h.params);
    const progress: AgentMessagePayload = { type: AgentMessageType.Progress, isFinal: false, requestId, attempt: 1,
      content: { stage: 'compose', message: 'Составляем Brief' } };
    h.emit(progress);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.repository.updateResponseProgress).toHaveBeenCalledWith(conversationId, requestId, 1, progress.content);
    expect(h.onResponseState).toHaveBeenCalledWith({ conversationId, responseState: expect.objectContaining({
      status: 'pending', progress: { ...progress.content, updatedAt: '2026-11-02T00:00:00.000Z' },
    }) });
    expect(h.repository.updateResponseProgress.mock.invocationCallOrder[0]).toBeLessThan(h.onResponseState.mock.invocationCallOrder[0]);
    expect(h.onAgent).not.toHaveBeenCalled();
    expect(h.repository.createMessage).not.toHaveBeenCalled();
    h.repository.updateResponseProgress.mockResolvedValueOnce(null);
    h.emit(progress);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.onResponseState).toHaveBeenCalledTimes(1);
    for (const state of [response('responded'), response('failed'), { ...response(), attempt: 2 }]) {
      h.repository.findResponseState.mockResolvedValue(state);
      h.emit(progress);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(h.repository.updateResponseProgress).toHaveBeenCalledTimes(2);
    await h.service.onModuleDestroy();
  });

  it('only a correlated terminal failure produces a retryable state, with no duplicate error bubble', async () => {
    const h = setup();
    await h.service.startChat(h.params);
    h.emit({ type: AgentMessageType.Error, isFinal: true, requestId, attempt: 1, content: { message: 'secret-provider-details' } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.repository.completeResponse).toHaveBeenCalledWith(conversationId, requestId, 1, 'failed', {
      code: 'AGENT_RESPONSE_FAILED', message: 'Не удалось получить ответ. Повторите попытку.', retryable: true,
    });
    expect(h.onResponseState).toHaveBeenCalled();
    expect(h.onAgent).not.toHaveBeenCalled();
    expect(h.agent.close).toHaveBeenCalledWith(conversationId);
  });

  it('does not settle a pending response on an empty question before the meaningful reply', async () => {
    const h = setup();
    h.repository.createMessage.mockImplementation(async (input) => ({ ...input, id: 'answer',
      ...(input.response && false !== input.response.settle ? { responseState: response('responded') } : {}),
    }));
    await h.service.startChat(h.params);
    h.emit({ type: AgentMessageType.Question, isFinal: false, requestId, attempt: 1,
      content: { kind: 'question', label: '   \n' } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.repository.createMessage.mock.calls[0][0].response).toEqual({ requestId, attempt: 1, settle: false });
    expect(h.onResponseState).not.toHaveBeenCalled();
    h.emit({ type: AgentMessageType.Message, isFinal: false, requestId, attempt: 1,
      content: { kind: 'text', label: 'Уточните задачу' } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.onResponseState).toHaveBeenCalledWith({ conversationId, responseState: response('responded') });
    await h.service.onModuleDestroy();
  });

  it('a late failure for a settled attempt cannot close the next turn', async () => {
    const h = setup();
    h.repository.completeResponse.mockResolvedValue(null);
    await h.service.startChat(h.params);
    h.emit({ type: AgentMessageType.Error, isFinal: true, requestId, attempt: 1, content: { message: 'late' } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.agent.close).not.toHaveBeenCalled();
    expect(h.onResponseState).not.toHaveBeenCalled();
    await h.service.onModuleDestroy();
  });

  it('explicitly resumes the saved failed turn once without adding a user message', async () => {
    const h = setup('failed');
    const params = { ...h.params, userMessageId: requestId, expectedAttempt: 1 };
    await h.service.retryResponse(params);
    expect(h.repository.retryResponse).toHaveBeenCalledWith(conversationId, 'owner', requestId, 1);
    expect(h.agent.send).toHaveBeenCalledTimes(1);
    expect(h.agent.send).toHaveBeenCalledWith(conversationId, expect.objectContaining({
      type: 'init', resume: true, requestId, attempt: 2,
      history: [expect.objectContaining({ id: requestId, role: 'user', content: { kind: 'text', label: 'Вопрос' } })],
    }));
    expect(h.repository.createUserResponse).not.toHaveBeenCalled();
    h.repository.retryResponse.mockResolvedValueOnce({ responseState: { ...response(), attempt: 2 }, started: false });
    await h.service.retryResponse(params);
    expect(h.agent.send).toHaveBeenCalledTimes(1);
    expect(h.onResponseState).toHaveBeenCalledTimes(2);
    await h.service.onModuleDestroy();
  });

  it.each(['initial', 'retry'])('marks a known connection rejection before %s dispatch as failed', async (mode) => {
    const h = setup();
    h.agent.connect.mockImplementation(() => { throw new Error('At capacity'); });
    if ('retry' === mode) await h.service.retryResponse({ ...h.params, userMessageId: requestId, expectedAttempt: 1 });
    else await h.service.sendUserMessage({ ...h.params, requestId, kind: 'text', value: 'Вопрос' });
    expect(h.repository.completeResponse).toHaveBeenCalledWith(conversationId, requestId, 'retry' === mode ? 2 : 1, 'failed',
      expect.objectContaining({ retryable: true }));
    expect(h.agent.send).not.toHaveBeenCalled();
    expect(h.onResponseState).toHaveBeenLastCalledWith({ conversationId, responseState: response('failed') });
    expect((h.service as unknown as { responseStateHandlers: Map<string, unknown> }).responseStateHandlers.size).toBe(0);
  });

  it('keeps a retry pending when dispatch delivery is uncertain', async () => {
    const h = setup();
    h.agent.send.mockImplementation(() => { throw new Error('Transport interrupted'); });
    await expect(h.service.retryResponse({ ...h.params, userMessageId: requestId, expectedAttempt: 1 })).rejects.toThrow();
    expect(h.repository.completeResponse).not.toHaveBeenCalled();
    await h.service.onModuleDestroy();
  });

  it('drops every stale attempt before persisting messages, recommendations or generations', async () => {
    const h = setup();
    h.repository.findResponseState.mockResolvedValue({ ...response(), attempt: 2 });
    await h.service.startChat(h.params);
    const payloads: AgentMessagePayload[] = [
      { type: AgentMessageType.Message, isFinal: false, content: { kind: 'text', label: 'Late answer' } },
      { type: AgentMessageType.Question, isFinal: false, content: { kind: 'question', label: 'Late question' } },
      { type: AgentMessageType.Recommendations, isFinal: false,
        content: { kind: 'recommendations', label: 'Late', benchmarks: [{ testId: 'test' }] } },
      { type: AgentMessageType.Result, isFinal: true, content: { kind: 'result', label: 'Late job', status: 'done' } },
      { type: AgentMessageType.Hypotheses, isFinal: true, content: { kind: 'hypotheses', testId: 'test', hypotheses: ['Late'] } },
      { type: AgentMessageType.Error, isFinal: true, content: { message: 'Late error' } },
    ];
    for (const payload of payloads) h.emit({ ...payload, requestId, attempt: 1 });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.repository.createMessage).not.toHaveBeenCalled();
    expect(h.repository.completeResponse).not.toHaveBeenCalled();
    expect(h.createMany).not.toHaveBeenCalled();
    expect(h.createGeneration).not.toHaveBeenCalled();
    expect(h.onAgent).not.toHaveBeenCalled();
    expect(h.agent.close).not.toHaveBeenCalled();
    await h.service.onModuleDestroy();
  });

  it('does not create recommendation cards if the atomic insert rejects a superseded attempt', async () => {
    const h = setup();
    h.repository.createMessage.mockResolvedValueOnce(null);
    await h.service.startChat(h.params);
    h.emit({ type: AgentMessageType.Recommendations, isFinal: false, requestId, attempt: 1,
      content: { kind: 'recommendations', label: 'Stale card', benchmarks: [{ testId: 'test' }] } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.repository.createMessage).toHaveBeenCalled();
    expect(h.createMany).not.toHaveBeenCalled();
    expect(h.onAgent).not.toHaveBeenCalled();
    await h.service.onModuleDestroy();
  });

  it('forwards progress only while its persisted attempt is pending without storing or settling it', async () => {
    const h = setup();
    await h.service.startChat(h.params);
    const progress: AgentMessagePayload = { type: AgentMessageType.Progress, isFinal: false, requestId, attempt: 1,
      content: { message: 'Ищу подходящие тесты' } };
    h.emit(progress);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.onAgent).toHaveBeenCalledWith({ ...progress, conversationId });
    expect(h.repository.createMessage).not.toHaveBeenCalled();
    expect(h.repository.completeResponse).not.toHaveBeenCalled();
    for (const state of [response('responded'), response('failed'), { ...response(), attempt: 2 }]) {
      h.repository.findResponseState.mockResolvedValue(state);
      h.emit(progress);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(h.onAgent).toHaveBeenCalledTimes(1);
    await h.service.onModuleDestroy();
  });

  it('persists a safe workflow error after the first reply without enabling retry or closing a newer turn', async () => {
    const h = setup('responded');
    const eventId = '33333333-3333-4333-8333-333333333333';
    h.repository.createMessage.mockImplementation(async (input) => ({ ...input, id: input.id }));
    await h.service.startChat(h.params);
    h.emit({ type: AgentMessageType.Error, isFinal: true, eventId, requestId, attempt: 1,
      content: { message: 'Private upstream details' } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.repository.createMessage).toHaveBeenCalledWith({ id: eventId, conversationId, role: 'agent', kind: 'text',
      content: 'Не удалось завершить ответ. Уже полученные результаты сохранены.',
      options: { kind: 'workflow_error', requestId, attempt: 1 }, response: { requestId, attempt: 1, settle: false } });
    expect(h.onAgent).toHaveBeenCalledWith(expect.objectContaining({ type: AgentMessageType.Message, id: eventId,
      content: { kind: 'text', label: 'Не удалось завершить ответ. Уже полученные результаты сохранены.' } }));
    expect(h.repository.completeResponse).not.toHaveBeenCalled();
    expect(h.onResponseState).not.toHaveBeenCalled();
    expect(h.agent.close).not.toHaveBeenCalled();
    await h.service.onModuleDestroy();
  });

  it('shows a legacy workflow error without inventing a persistence ID', async () => {
    const h = setup('responded');
    await h.service.startChat(h.params);
    h.emit({ type: AgentMessageType.Error, isFinal: true, requestId, attempt: 1,
      content: { message: 'Private upstream details' } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.repository.createMessage).not.toHaveBeenCalled();
    expect(h.onAgent).toHaveBeenCalledWith({ type: AgentMessageType.Error, isFinal: true, requestId, attempt: 1, conversationId,
      content: { message: 'Не удалось завершить ответ. Уже полученные результаты сохранены.' } });
    await h.service.onModuleDestroy();
  });

  it('keeps a workflow error visible when another replica saves the first reply before its failure transition', async () => {
    const h = setup();
    h.repository.completeResponse.mockResolvedValueOnce(null);
    h.repository.findResponseState.mockResolvedValueOnce(response()).mockResolvedValue(response('responded'));
    h.repository.createMessage.mockImplementation(async (input) => ({ ...input, id: input.id }));
    await h.service.startChat(h.params);
    h.emit({ type: AgentMessageType.Error, isFinal: true, requestId, attempt: 1,
      eventId: '33333333-3333-4333-8333-333333333333', content: { message: 'Tool failed' } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.repository.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      options: { kind: 'workflow_error', requestId, attempt: 1 }, response: { requestId, attempt: 1, settle: false },
    }));
    expect(h.agent.close).not.toHaveBeenCalled();
    await h.service.onModuleDestroy();
  });

  it('does not let queued errors from a replaced transport close an explicit retry', async () => {
    const h = setup();
    await h.service.startChat(h.params);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    (h.service as unknown as { messageProcessing: Map<string, Promise<void>> }).messageProcessing.set(conversationId, blocked);
    h.emit({ type: AgentMessageType.Error, isFinal: true, content: { message: 'Old transport disconnected' } });
    await h.service.retryResponse({ ...h.params, userMessageId: requestId, expectedAttempt: 1 });
    expect(h.agent.close).toHaveBeenCalledTimes(1);
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.agent.close).toHaveBeenCalledTimes(1);
    expect(h.onAgent).not.toHaveBeenCalled();
    expect(h.agent.send).toHaveBeenLastCalledWith(conversationId, expect.objectContaining({ resume: true, attempt: 2 }));
    await h.service.onModuleDestroy();
  });
});
