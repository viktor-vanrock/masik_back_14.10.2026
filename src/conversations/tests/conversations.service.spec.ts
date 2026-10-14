import { AgentMessageType } from '@/common/enums/agentMessageType.enum';
import { Role } from '@/common/enums/role.enum';
import {
  Conversation,
  ConversationIntent,
  ConversationStatus,
  MessageKind,
  MessageRole,
} from '@/generated/prisma/client';
import { HypothesesService } from '@/hypotheses/hypotheses.service';
import { RecommendationRequestsService } from '@/recommendations/recommendation-requests.service';
import { RecommendationsService } from '@/recommendations/recommendations.service';
import { ConversationsService } from '../conversations.service';
import type { AgentMessagePayload } from '../types';

describe('ConversationsService recommendation/interviewer boundary', () => {
  const repository = {
    createConversation: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
    findByIdWithMessages: jest.fn(),
    updateIntent: jest.fn(),
    updateStatus: jest.fn(),
    createMessage: jest.fn(),
    completeWithRecommendation: jest.fn(),
    beginBenchmarkCreation: jest.fn(),
    getAgentContext: jest.fn(),
    updateAgentContext: jest.fn(),
  };
  const agent = {
    connect: jest.fn(),
    onMessage: jest.fn(),
    send: jest.fn(),
    close: jest.fn(),
    acknowledgeMessage: jest.fn(),
  };
  const recommendationRequests = {} as RecommendationRequestsService;
  const hypotheses = {} as HypothesesService;
  const createMany = jest.fn();
  const recommendations = { createMany } as unknown as RecommendationsService;
  let service: ConversationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    repository.beginBenchmarkCreation.mockResolvedValue(true);
    repository.completeWithRecommendation.mockResolvedValue(true);
    service = new ConversationsService(
      repository,
      agent,
      recommendationRequests,
      hypotheses,
      recommendations
    );
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('scopes ordinary HTTP list reads to the authenticated owner', async () => {
    repository.findAll.mockResolvedValue({ data: [], total: 0 });
    const query = { page: 1, limit: 20 };

    await expect(
      service.findAll(query, {
        id: 'user-id',
        username: 'user',
        role: Role.User,
      })
    ).resolves.toEqual({ data: [], total: 0 });

    expect(repository.findAll).toHaveBeenCalledWith(query, 'user-id');
  });

  it.each([Role.Admin, Role.SuperUser])(
    'scopes %s list reads to the authenticated owner',
    async (role) => {
      repository.findAll.mockResolvedValue({ data: [], total: 0 });
      const query = { page: 1, limit: 20 };

      await service.findAll(query, {
        id: 'staff-id',
        username: 'staff',
        role,
      });

      expect(repository.findAll).toHaveBeenCalledWith(query, 'staff-id');
    }
  );

  it('scopes conversation detail reads and hides foreign IDs as not found', async () => {
    const conversation = conversationRecord();
    const actor = {
      id: conversation.userId,
      username: 'user',
      role: Role.User,
    };
    repository.findByIdWithMessages
      .mockResolvedValueOnce({
        ...conversation,
        messages: [],
        recommendations: [],
        recommendationRequests: [],
      })
      .mockResolvedValueOnce(null);

    await expect(
      service.findByIdWithMessages(conversation.id, actor)
    ).resolves.toMatchObject({ id: conversation.id });
    expect(repository.findByIdWithMessages).toHaveBeenNthCalledWith(
      1,
      conversation.id,
      conversation.userId
    );

    await expect(
      service.findByIdWithMessages('foreign-id', actor)
    ).rejects.toThrow('Conversation "foreign-id" was not found');
  });

  it.each([Role.Admin, Role.SuperUser])(
    'scopes %s conversation detail reads to the authenticated owner',
    async (role) => {
      const conversation = conversationRecord({ userId: 'staff-id' });
      repository.findById
        .mockResolvedValueOnce(conversation)
        .mockResolvedValueOnce(null);
      repository.findByIdWithMessages
        .mockResolvedValueOnce({
          ...conversation,
          messages: [],
          recommendations: [],
          recommendationRequests: [],
        })
        .mockResolvedValueOnce(null);
      const actor = { id: 'staff-id', username: 'staff', role };

      await expect(service.findById(conversation.id, actor)).resolves.toBe(
        conversation
      );
      expect(repository.findById).toHaveBeenCalledWith(conversation.id, 'staff-id');
      await expect(service.findById('foreign-id', actor)).rejects.toThrow(
        'Conversation "foreign-id" was not found'
      );

      await expect(service.findByIdWithMessages(conversation.id, actor))
        .resolves.toMatchObject({ id: conversation.id });
      expect(repository.findByIdWithMessages).toHaveBeenCalledWith(
        conversation.id,
        'staff-id'
      );
      await expect(service.findByIdWithMessages('foreign-id', actor))
        .rejects.toThrow('Conversation "foreign-id" was not found');
    }
  );

  it('connects the conversational Interviewer for a fresh conversation', async () => {
    const conversation = conversationRecord();
    repository.createConversation.mockResolvedValue(conversation);
    repository.findByIdWithMessages.mockResolvedValue({ ...conversation, messages: [],
      recommendations: [], recommendationRequests: [] });

    await expect(service.startChat({
      userId: conversation.userId,
      onAgent: jest.fn(),
    })).resolves.toBe(conversation.id);

    expect(agent.connect).toHaveBeenCalledWith(conversation.id);
    expect(agent.send).toHaveBeenCalledWith(conversation.id, expect.objectContaining({ type: 'init', intent: null }));
  });

  it('keeps chat available while durable generation is running without restarting generation', async () => {
    const conversation = conversationRecord({ intent: ConversationIntent.create_new,
      status: ConversationStatus.generating });
    repository.findById.mockResolvedValue(conversation);
    repository.findByIdWithMessages.mockResolvedValue({ ...conversation, messages: [],
      recommendations: [], recommendationRequests: [] });
    const params = { conversationId: conversation.id, userId: conversation.userId, onAgent: jest.fn() };
    await service.startChat(params);
    await service.startBenchmarkCreation(params);
    expect(agent.connect).toHaveBeenCalledWith(conversation.id);
    expect(agent.send).toHaveBeenCalledTimes(1);
    expect(repository.beginBenchmarkCreation).not.toHaveBeenCalled();
  });

  it('restores question state and generation progress after a new connection without duplicating an active init', async () => {
    const conversation = conversationRecord({ intent: ConversationIntent.create_new });
    repository.findById.mockResolvedValue(conversation);
    repository.findByIdWithMessages.mockResolvedValue({
      ...conversation,
      messages: [{
        id: 'question', role: MessageRole.agent, kind: MessageKind.question,
        content: 'Choose format', optionId: 'output_format', options: null,
        interviewState: { topic: 'medicine' }, createdAt: new Date('2026-10-01T10:00:00Z'),
      }, {
        id: 'result', role: MessageRole.agent, kind: MessageKind.result,
        content: 'Generating', optionId: null,
        options: { status: 'generating', generationJobId: 'job-id' },
        interviewState: null, createdAt: new Date('2026-10-01T10:01:00Z'),
      }],
      recommendations: [], recommendationRequests: [],
    });
    const params = { conversationId: conversation.id, userId: conversation.userId, onAgent: jest.fn() };
    await service.startChat(params);
    await service.startChat(params);
    expect(agent.send).toHaveBeenCalledTimes(1);
    expect(repository.findByIdWithMessages).toHaveBeenCalledWith(conversation.id, conversation.userId);
    expect(agent.send).toHaveBeenCalledWith(conversation.id, expect.objectContaining({
      conversationId: conversation.id,
      history: [
        { id: 'question', role: 'agent', content: { kind: 'question', label: 'Choose format',
          questionKey: 'output_format', interviewState: { topic: 'medicine' } } },
        { id: 'result', role: 'agent', content: { kind: 'result', label: 'Generating',
          status: 'generating', generationJobId: 'job-id' } },
      ],
    }));
  });

  it('preserves selection explanations and canonical test identity in owner history', async () => {
    const conversation = conversationRecord();
    repository.findByIdWithMessages.mockResolvedValue({ ...conversation, messages: [],
      recommendations: [], recommendationRequests: [{ resultPayload: [{
        benchmarkId: 'test-id', explanation: 'Fits the requested task', rank: 1,
      }] }],
    });
    const result = await service.findByIdWithMessages(conversation.id, {
      id: conversation.userId, username: 'owner', role: Role.User,
    });
    expect(result.recommendationRequests[0].resultPayload).toEqual([{
      testId: 'test-id', explanation: 'Fits the requested task', rank: 1,
    }]);
  });

  it('keeps generating results pending and persists interviewer question state', async () => {
    const conversation = conversationRecord({ intent: ConversationIntent.create_new });
    repository.findById.mockResolvedValue(conversation);
    repository.findByIdWithMessages.mockResolvedValue({ ...conversation, messages: [],
      recommendations: [], recommendationRequests: [],
    });
    repository.createMessage.mockResolvedValue({ id: 'saved-message' });
    let subscriber: ((payload: AgentMessagePayload) => void) | undefined;
    agent.onMessage.mockImplementation((_id, callback) => { subscriber = callback; });
    await service.startChat({ conversationId: conversation.id, userId: conversation.userId, onAgent: jest.fn() });
    subscriber?.({ type: AgentMessageType.Question, isFinal: false, content: {
      kind: 'question', label: 'Format?', questionKey: 'output_format', interviewState: { topic: 'medicine' },
    } });
    subscriber?.({ type: AgentMessageType.Result, isFinal: false, content: {
      kind: 'result', label: 'Generating', status: 'generating', generationJobId: 'job-id',
    } });
    await flushPromises();
    await flushPromises();
    expect(repository.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      optionId: 'output_format', interviewState: { topic: 'medicine' },
    }));
    expect(repository.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      options: { status: 'generating', generationJobId: 'job-id' },
    }));
    expect(repository.updateStatus).not.toHaveBeenCalled();
    expect(agent.close).not.toHaveBeenCalled();
  });

  it('forwards explicit creation intent and rejection after the atomic transition', async () => {
    const conversation = conversationRecord({
      intent: ConversationIntent.find_existing,
      status: ConversationStatus.awaiting_choice,
    });
    repository.findById.mockResolvedValue(conversation);
    repository.findByIdWithMessages.mockResolvedValue({
      ...conversation,
      messages: [{
        id: 'message-id',
        conversationId: conversation.id,
        role: MessageRole.user,
        kind: MessageKind.recommendation_rejected,
        content: 'medical-test',
        optionId: null,
        options: null,
        createdAt: new Date('2026-08-25T12:01:00.000Z'),
      }],
      recommendations: [],
      recommendationRequests: [{
        id: 'request-id',
        conversationId: conversation.id,
        query: 'Нужен медицинский бенчмарк',
        topK: 1,
        status: 'completed',
        attemptCount: 1,
        maxAttempts: 1,
        nextRetryAt: null,
        retrievalVersion: 'test',
        rerankerVersion: 'test',
        retrievalDurationMs: 1,
        resultPayload: [],
        errorCode: null,
        errorMessage: null,
        retryable: null,
        completedAt: new Date('2026-08-25T12:00:30.000Z'),
        createdAt: new Date('2026-08-25T12:00:00.000Z'),
        updatedAt: new Date('2026-08-25T12:00:30.000Z'),
      }],
      hypothesisGenerations: [],
    });

    await service.startBenchmarkCreation({
      userId: conversation.userId,
      conversationId: conversation.id,
      rejectedTestId: 'medical-test',
      onAgent: jest.fn(),
    });

    expect(repository.beginBenchmarkCreation).toHaveBeenCalledWith(
      conversation.id,
      ConversationIntent.find_existing,
      'medical-test'
    );
    expect(agent.connect).toHaveBeenCalledWith(conversation.id);
    expect(agent.send).toHaveBeenCalledWith(
      conversation.id,
      expect.objectContaining({
        type: 'init',
        intent: ConversationIntent.create_new,
        history: [
          expect.objectContaining({
            content: expect.objectContaining({
              label: 'Нужен медицинский бенчмарк',
            }),
          }),
          expect.objectContaining({
            content: expect.objectContaining({
              testId: 'medical-test',
            }),
          }),
        ],
      })
    );
  });

  it('serializes duplicate creation starts without a second transition or init', async () => {
    const before = conversationRecord({
      intent: ConversationIntent.find_existing,
      status: ConversationStatus.awaiting_choice,
    });
    const after = conversationRecord({
      intent: ConversationIntent.create_new,
      status: ConversationStatus.active,
    });
    repository.findById
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    repository.findByIdWithMessages.mockResolvedValue({
      ...after,
      messages: [],
      recommendations: [],
      recommendationRequests: [],
    });
    const params = {
      userId: before.userId,
      conversationId: before.id,
      rejectedTestId: 'medical-test',
      onAgent: jest.fn(),
    };

    await Promise.all([
      service.startBenchmarkCreation(params),
      service.startBenchmarkCreation(params),
    ]);

    expect(repository.beginBenchmarkCreation).toHaveBeenCalledTimes(1);
    expect(repository.beginBenchmarkCreation).toHaveBeenCalledWith(
      before.id,
      ConversationIntent.find_existing,
      'medical-test'
    );
    expect(agent.connect).toHaveBeenCalledTimes(1);
    expect(agent.send).toHaveBeenCalledTimes(2);
  });

  it('delegates recommendation completion to one atomic repository action', async () => {
    await service.acceptRecommendation('conversation-id', 'benchmark-id');

    expect(repository.completeWithRecommendation).toHaveBeenCalledWith(
      'conversation-id',
      'benchmark-id'
    );
    expect(repository.createMessage).not.toHaveBeenCalled();
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it('does not reconnect Interviewer for a conversation owned by another user', async () => {
    const conversation = conversationRecord({
      intent: ConversationIntent.create_new,
    });
    repository.findById.mockResolvedValue(conversation);

    await expect(
      service.regenerateHypotheses({
        userId: 'another-user',
        conversationId: conversation.id,
        onAgent: jest.fn(),
      })
    ).rejects.toThrow(`Conversation "${conversation.id}" was not found`);

    expect(agent.connect).not.toHaveBeenCalled();
    expect(agent.send).not.toHaveBeenCalled();
  });

  it('serializes fast Interviewer frames before persisting the next one', async () => {
    const conversation = conversationRecord({
      intent: ConversationIntent.create_new,
    });
    repository.findById.mockResolvedValue(conversation);
    repository.findByIdWithMessages.mockResolvedValue({
      ...conversation,
      messages: [],
      recommendations: [],
      recommendationRequests: [],
    });
    let subscriber: ((payload: AgentMessagePayload) => void) | undefined;
    agent.onMessage.mockImplementation((_id, callback) => {
      subscriber = callback;
    });
    let releaseFirst!: () => void;
    repository.createMessage
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = () => resolve({ id: 'first-message' });
          })
      )
      .mockResolvedValueOnce({ id: 'second-message' });
    const onAgent = jest.fn();

    await service.startBenchmarkCreation({
      userId: conversation.userId,
      conversationId: conversation.id,
      onAgent,
    });
    subscriber?.(question('first'));
    subscriber?.(question('second'));
    await flushPromises();

    expect(repository.createMessage).toHaveBeenCalledTimes(1);
    releaseFirst();
    await flushPromises();
    await flushPromises();

    expect(repository.createMessage).toHaveBeenCalledTimes(2);
    expect(onAgent.mock.calls.map(([payload]) => payload.content.label)).toEqual([
      'first',
      'second',
    ]);
  });

  it('forwards a terminal Interviewer transport error and releases the session', async () => {
    const conversation = conversationRecord({
      intent: ConversationIntent.create_new,
    });
    repository.findById.mockResolvedValue(conversation);
    repository.findByIdWithMessages.mockResolvedValue({
      ...conversation,
      messages: [],
      recommendations: [],
      recommendationRequests: [],
    });
    let subscriber: ((payload: AgentMessagePayload) => void) | undefined;
    agent.onMessage.mockImplementation((_id, callback) => {
      subscriber = callback;
    });
    const onAgent = jest.fn();

    await service.startBenchmarkCreation({
      userId: conversation.userId,
      conversationId: conversation.id,
      onAgent,
    });
    subscriber?.({
      type: AgentMessageType.Error,
      isFinal: true,
      content: { message: 'upstream overloaded' },
    });
    await flushPromises();

    expect(onAgent).toHaveBeenCalledWith({
      type: AgentMessageType.Error,
      isFinal: true,
      content: { message: 'upstream overloaded' },
      conversationId: conversation.id,
    });
    expect(agent.close).toHaveBeenCalledWith(conversation.id);
    expect(repository.createMessage).not.toHaveBeenCalled();
  });

  it('keeps processing conversational frames after a completed result', async () => {
    const conversation = conversationRecord({
      intent: ConversationIntent.create_new,
    });
    repository.findById.mockResolvedValue(conversation);
    repository.findByIdWithMessages.mockResolvedValue({
      ...conversation,
      messages: [],
      recommendations: [],
      recommendationRequests: [],
    });
    repository.createMessage.mockResolvedValue({ id: 'final-message' });
    let subscriber: ((payload: AgentMessagePayload) => void) | undefined;
    agent.onMessage.mockImplementation((_id, callback) => {
      subscriber = callback;
    });

    await service.startBenchmarkCreation({
      userId: conversation.userId,
      conversationId: conversation.id,
      onAgent: jest.fn(),
    });
    subscriber?.({
      type: AgentMessageType.Result,
      isFinal: true,
      content: {
        kind: 'result',
        label: 'done',
        status: 'done',
      },
    });
    subscriber?.(question('Follow-up question'));
    await flushPromises();
    await flushPromises();

    expect(repository.createMessage).toHaveBeenCalledTimes(2);
    expect(repository.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'done' })
    );
    expect(agent.close).not.toHaveBeenCalled();
  });

  it('persists ranked recommendation cards before following text, then restores stable IDs on reconnect', async () => {
    const conversation = conversationRecord({ intent: ConversationIntent.find_existing });
    repository.findById.mockResolvedValue(conversation);
    const cardsId = '11111111-1111-4111-8111-111111111111';
    const textId = '22222222-2222-4222-8222-222222222222';
    repository.findByIdWithMessages.mockResolvedValue({ ...conversation, messages: [],
      recommendations: [], recommendationRequests: [] });
    let subscriber: ((payload: AgentMessagePayload) => void) | undefined;
    agent.onMessage.mockImplementation((_id, callback) => { subscriber = callback; });
    let releaseCards!: () => void;
    createMany.mockImplementationOnce(() => new Promise((resolve) => {
      releaseCards = () => resolve([{ id: 'rec-b', testId: 'b' }, { id: 'rec-a', testId: 'a' }]);
    }));
    repository.createMessage.mockImplementation(async (input) => ({ ...input, id: input.id }));
    const onAgent = jest.fn();
    const params = { userId: conversation.userId, conversationId: conversation.id, onAgent };
    await service.startChat(params);
    const benchmarks = [{ testId: 'a', explanation: 'Best fit' }, { testId: 'b' }];
    subscriber?.({ type: AgentMessageType.Recommendations, isFinal: false, eventId: cardsId,
      content: { kind: 'recommendations', label: 'Нашёл тесты', benchmarks } });
    subscriber?.({ type: AgentMessageType.Message, isFinal: false, eventId: textId,
      content: { kind: 'text', label: 'Можно выбрать или создать свой.' } });
    await flushPromises();
    expect(repository.createMessage).not.toHaveBeenCalled();
    expect(agent.acknowledgeMessage).not.toHaveBeenCalled();
    releaseCards();
    await flushPromises();
    await flushPromises();
    expect(onAgent.mock.calls.map(([payload]) => payload.id)).toEqual([cardsId, textId]);
    expect(onAgent.mock.calls[0][0].recommendations.map((rec: { testId: string }) => rec.testId)).toEqual(['a', 'b']);
    expect(repository.createMessage.mock.calls[0][0]).toMatchObject({ id: cardsId,
      options: { kind: 'recommendations', benchmarks } });
    expect(agent.acknowledgeMessage.mock.calls).toEqual([[conversation.id, cardsId], [conversation.id, textId]]);
    expect(repository.updateStatus).not.toHaveBeenCalled();
    expect(agent.close).not.toHaveBeenCalled();
    service.closeSession(conversation.id);
    repository.findByIdWithMessages.mockResolvedValue({ ...conversation,
      messages: repository.createMessage.mock.calls.map(([input], index) => ({ ...input,
        optionId: null, interviewState: null, createdAt: new Date(index) })),
      recommendations: [], recommendationRequests: [] });
    await service.startChat(params);
    expect(agent.send).toHaveBeenLastCalledWith(conversation.id, expect.objectContaining({
      history: [{ id: cardsId, role: 'agent', content: { kind: 'recommendations', label: 'Нашёл тесты', benchmarks } },
        { id: textId, role: 'agent', content: { kind: 'text', label: 'Можно выбрать или создать свой.' } }],
    }));
  });

  it('forwards arbitrary text and rejection in one conversation without requiring creation mode', async () => {
    const conversation = conversationRecord({ intent: ConversationIntent.find_existing,
      status: ConversationStatus.awaiting_choice });
    repository.findById.mockResolvedValue(conversation);
    repository.createMessage.mockResolvedValue({ id: 'saved' });
    const onAgent = jest.fn();
    await service.sendUserMessage({ conversationId: conversation.id, userId: conversation.userId,
      kind: 'text', value: 'А как вообще работают метрики?', onAgent });
    await service.sendUserMessage({ conversationId: conversation.id, userId: conversation.userId,
      kind: 'recommendation_rejected', value: 'remote-test', onAgent });
    expect(agent.send).toHaveBeenCalledWith(conversation.id, { type: 'message',
      content: { kind: 'text', label: 'А как вообще работают метрики?' } });
    expect(agent.send).toHaveBeenCalledWith(conversation.id, { type: 'message',
      content: { kind: 'recommendation_rejected', testId: 'remote-test' } });
    expect(repository.updateIntent).toHaveBeenCalledWith(conversation.id, ConversationIntent.create_new);
  });
});

function conversationRecord(
  overrides: Partial<Conversation> = {}
): Conversation {
  const now = new Date('2026-08-25T12:00:00.000Z');
  return {
    id: 'ddce101a-f9c6-44a7-8e4b-f0e7c91616c1',
    userId: 'user-id',
    status: ConversationStatus.active,
    intent: null,
    agentContext: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function question(label: string): AgentMessagePayload {
  return {
    type: AgentMessageType.Question,
    isFinal: false,
    content: { kind: 'question', label },
  };
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
