import { NotFoundException } from '@nestjs/common';
import { Role } from '@/common/enums/role.enum';
import { WsEvent } from '@/common/enums/wsEvents.enum';
import { ConversationsGateway } from '../conversations.gateway';
import type { ConversationsService } from '../conversations.service';
import type { WsJwtAuthGuard } from '@/auth/jwt/ws-jwt-auth.guard';
import type { RequestUser } from '@/common/types/request.type';
import type { RecommendationsService } from '@/recommendations/recommendations.service';
import type { Socket } from 'socket.io';

type TestableGateway = {
  bindSocket(client: Socket, conversationId: string): void;
  subscribers: Map<string, Map<string, Socket>>;
  pushAgentMessage(client: Socket, payload: unknown): void;
};

describe('ConversationsGateway socket ownership', () => {
  const closeSession = jest.fn();
  const service = { closeSession } as unknown as ConversationsService;
  let gateway: ConversationsGateway;

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new ConversationsGateway(
      service,
      {} as RecommendationsService,
      {} as WsJwtAuthGuard
    );
  });

  it('keeps Interviewer work alive when one socket switches chats or disconnects', () => {
    const client = socket('socket-1');
    const testable = gateway as unknown as TestableGateway;
    testable.bindSocket(client, 'conversation-1');

    testable.bindSocket(client, 'conversation-2');
    gateway.handleDisconnect(client);

    expect(closeSession).not.toHaveBeenCalled();
  });

  it('does not let a stale replaced socket close the current session', () => {
    const stale = socket('socket-1');
    const current = socket('socket-2');
    const testable = gateway as unknown as TestableGateway;
    testable.bindSocket(stale, 'conversation-1');
    testable.bindSocket(current, 'conversation-1');

    gateway.handleDisconnect(stale);
    expect(closeSession).not.toHaveBeenCalled();

    gateway.handleDisconnect(current);
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('bounds subscriptions to the current chat and retains delivery to another active tab', () => {
    const first = socket('first');
    const second = socket('second');
    const firstEmit = jest.fn();
    const secondEmit = jest.fn();
    Object.assign(first, { emit: firstEmit });
    Object.assign(second, { emit: secondEmit });
    const testable = gateway as unknown as TestableGateway;
    testable.bindSocket(first, 'chat-a');
    testable.bindSocket(second, 'chat-a');
    testable.bindSocket(first, 'chat-b');
    expect([...testable.subscribers.get('chat-a')!.keys()]).toEqual(['second']);
    gateway.handleDisconnect(first);
    Object.assign(first, { connected: false });
    expect(testable.subscribers.has('chat-b')).toBe(false);
    const payload = { type: 'message', conversationId: 'chat-a', content: { kind: 'text', label: 'Ответ' } };
    testable.pushAgentMessage(first, payload);
    expect(secondEmit).toHaveBeenCalledWith(WsEvent.AgentMessage, payload);
    expect(firstEmit).not.toHaveBeenCalled();
    gateway.handleDisconnect(second);
    expect(testable.subscribers.size).toBe(0);
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('sends ephemeral progress on its dedicated event instead of creating a chat bubble', () => {
    const emit = jest.fn();
    const client = Object.assign(socket('first'), { emit });
    const testable = gateway as unknown as TestableGateway;
    testable.bindSocket(client, 'chat-a');
    testable.pushAgentMessage(client, { type: 'progress', isFinal: false, conversationId: 'chat-a',
      requestId: 'request', attempt: 2, content: { message: 'Ищу подходящие тесты' } });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(WsEvent.AgentProgress, {
      conversationId: 'chat-a', requestId: 'request', attempt: 2, message: 'Ищу подходящие тесты',
    });
  });

  it('preserves the intermediate turn marker when mapping recommendation cards', () => {
    const emit = jest.fn();
    const client = Object.assign(socket('first'), { emit });
    const testable = gateway as unknown as TestableGateway;
    testable.bindSocket(client, 'chat-a');
    testable.pushAgentMessage(client, { type: 'recommendations', isFinal: false, id: 'card', conversationId: 'chat-a',
      turnComplete: false, requestId: 'user-turn', attempt: 1,
      content: { kind: 'recommendations', label: 'Подходящие тесты', benchmarks: [] }, recommendations: [] });
    expect(emit).toHaveBeenCalledWith(WsEvent.RecommendationResult, expect.objectContaining({
      requestId: 'card', turnComplete: false, conversationId: 'chat-a',
    }));
  });
});

describe('ConversationsGateway recommendation ownership', () => {
  const findByIdForUser = jest.fn();
  const updateStatus = jest.fn();
  const acceptRecommendation = jest.fn();
  const startBenchmarkCreation = jest.fn();
  const sendUserMessage = jest.fn();
  const recommendations = {
    findByIdForUser,
    updateStatus,
  } as unknown as RecommendationsService;
  const service = {
    acceptRecommendation,
    startBenchmarkCreation,
    sendUserMessage,
  } as unknown as ConversationsService;
  const user = {
    id: 'staff-user-id',
    username: 'staff',
    role: Role.Admin,
  } as RequestUser;
  let gateway: ConversationsGateway;
  let client: Socket;
  let emit: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new ConversationsGateway(
      service,
      recommendations,
      {} as WsJwtAuthGuard
    );
    emit = jest.fn();
    client = { id: 'socket-1', emit } as unknown as Socket;
  });

  it.each(['onSelectRecommendation', 'onRejectRecommendation'] as const)(
    '%s rejects another user\'s recommendation before changing anything',
    async (handler) => {
      findByIdForUser.mockRejectedValue(
        new NotFoundException('Recommendation was not found')
      );

      await gateway[handler](client, user, {
        recommendationId: 'other-user-recommendation',
      });

      expect(findByIdForUser).toHaveBeenCalledWith(
        'other-user-recommendation',
        user.id
      );
      expect(updateStatus).not.toHaveBeenCalled();
      expect(acceptRecommendation).not.toHaveBeenCalled();
      expect(startBenchmarkCreation).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith(WsEvent.Error, {
        message: 'Recommendation was not found',
      });
    }
  );

  it.each([
    ['onSelectRecommendation', 'recommendation_selected'],
    ['onRejectRecommendation', 'recommendation_rejected'],
  ] as const)('%s forwards one canonical action and preserves the active chat', async (handler, kind) => {
    const recommendation = { id: 'rec', conversationId: 'chat', testId: 'remote-test' };
    findByIdForUser.mockResolvedValue(recommendation);
    updateStatus.mockResolvedValueOnce({ recommendation, transitioned: true })
      .mockResolvedValueOnce({ recommendation, transitioned: false });
    await gateway[handler](client, user, { recommendationId: 'rec' });
    await gateway[handler](client, user, { recommendationId: 'rec' });
    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(sendUserMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'chat', userId: user.id, kind, value: 'remote-test',
    }));
    expect(acceptRecommendation).not.toHaveBeenCalled();
    expect(startBenchmarkCreation).not.toHaveBeenCalled();
  });
});

it('delivers Factory explanations unchanged with canonical test IDs', async () => {
  const result = { status: 'completed', requestId: 'request-id', conversationId: 'conversation-id',
    recommendations: [{ id: 'recommendation-id', testId: 'test-id' }],
    explanations: [{ testId: 'test-id', explanation: 'Fits the request' }],
  };
  const service = {
    requestRecommendations: jest.fn().mockResolvedValue({ id: 'request-id', conversationId: 'conversation-id' }),
    executeRecommendationRequest: jest.fn().mockResolvedValue(result),
  } as unknown as ConversationsService;
  const gateway = new ConversationsGateway(service, {} as RecommendationsService, {} as WsJwtAuthGuard);
  const emit = jest.fn();
  const client = { id: 'socket-id', emit } as unknown as Socket;
  await gateway.onRequestRecommendations(client, { id: 'owner' } as RequestUser, {
    conversationId: 'conversation-id', query: 'Medical benchmark',
  });
  expect(emit).toHaveBeenCalledWith(WsEvent.RecommendationResult, result);
});

function socket(id: string): Socket {
  return { id } as Socket;
}
