import { EventEmitter, once } from 'events';
import {
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import WebSocket, { WebSocketServer } from 'ws';
import { AgentMessageType } from '@/common/enums/agentMessageType.enum';
import {
  AgentWsService,
  type SessionState,
} from '../agent/agent.ws.service';
import type { AgentEnvType } from '@/configs/types';
import type { ConfigService } from '@nestjs/config';
import type { AddressInfo } from 'net';

type TestableAgentWsService = {
  sessions: Map<string, SessionState>;
  openSocket(conversationId: string): void;
  onSocketOpen(conversationId: string): void;
  onSocketMessage(conversationId: string, raw: Buffer): void;
  onSocketClose(conversationId: string, code: number): void;
  onPong(conversationId: string): void;
  startHeartbeat(conversationId: string): void;
};

const conversationId = '11111111-1111-4111-8111-111111111111';
const init = {
  type: 'init' as const,
  intent: 'create_new' as const,
  history: [],
};

describe('AgentWsService reconnect context', () => {
  it('validates ephemeral progress and never appends it to reconnect history', () => {
    const service = configuredService();
    const testable = service as unknown as TestableAgentWsService;
    const state = session(socketStub());
    testable.sessions.set(conversationId, state);
    service.send(conversationId, init);
    const received = jest.fn();
    service.onMessage(conversationId, received);
    const requestId = '22222222-2222-4222-8222-222222222222';
    const progress = { type: AgentMessageType.Progress, isFinal: false, requestId, attempt: 1,
      content: { message: 'Ищу подходящие тесты' } };
    testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify(progress)));
    expect(received).toHaveBeenCalledWith(progress);
    expect(state.lastInit?.history).toEqual([]);
    for (const invalid of [
      { ...progress, requestId: undefined }, { ...progress, attempt: 0 }, { ...progress, isFinal: true },
      { ...progress, content: { message: ' ' } }, { ...progress, content: { message: 'A'.repeat(501) } },
      { ...progress, content: { message: { unsafe: true } } },
      { ...progress, content: { message: 'Составляем бриф', stage: 'inventor' } },
    ]) testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify(invalid)));
    expect(received).toHaveBeenCalledTimes(1);
    service.close(conversationId);
  });

  it('preserves validated Brief stage and explicit turn completion through normalized frames', () => {
    const service = configuredService();
    const testable = service as unknown as TestableAgentWsService;
    testable.sessions.set(conversationId, session(socketStub()));
    service.send(conversationId, init);
    const received = jest.fn();
    service.onMessage(conversationId, received);
    const turn = { requestId: '22222222-2222-4222-8222-222222222222', attempt: 1 };
    const progress = { ...turn, type: 'progress', isFinal: false, content: { stage: 'compose', message: 'Составляем бриф' } };
    const result = { ...turn, type: 'result', isFinal: true, turnComplete: true,
      content: { kind: 'result', label: 'Бриф сохранён', status: 'brief_ready' } };
    const recommendation = { ...turn, type: 'recommendations', isFinal: false, turnComplete: false,
      content: { kind: 'recommendations', label: 'Нашёл варианты', benchmarks: [] } };
    for (const payload of [progress, recommendation, result]) {
      testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify(payload)));
      expect(received).toHaveBeenLastCalledWith(payload);
    }
    testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify({ ...result, turnComplete: 'true' })));
    expect(received).toHaveBeenCalledTimes(3);
    service.close(conversationId);
  });

  it('roundtrips a structured question, its selection and readonly reconnect with original option IDs and labels', () => {
    const service = configuredService();
    const testable = service as unknown as TestableAgentWsService;
    const ws = socketStub();
    const state = session(ws);
    testable.sessions.set(conversationId, state);
    service.send(conversationId, init);
    const received = jest.fn();
    service.onMessage(conversationId, received);
    const eventId = '33333333-3333-4333-8333-333333333333';
    const options = [{ id: 'accuracy', label: 'Улучшить точность' }, { id: 'speed', label: 'Скорость' }];
    const question = { type: 'question', isFinal: false, turnComplete: true, eventId,
      content: { kind: 'question', label: 'Что проверяем?', options } };
    testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify(question)));
    expect(received).toHaveBeenCalledWith(question);
    service.acknowledgeMessage(conversationId, eventId);
    service.send(conversationId, { type: 'message', content: { kind: 'option', ...options[0] } });
    expect(JSON.parse(ws.send.mock.calls.at(-1)![0] as string).content).toEqual({ kind: 'option', ...options[0] });
    state.openedOnce = true;
    ws.send.mockClear();
    testable.onSocketOpen(conversationId);
    expect(JSON.parse(ws.send.mock.calls[0][0] as string)).toMatchObject({ resume: false, history: [
      { id: eventId, role: 'agent', content: question.content },
      { role: 'user', content: { kind: 'option', ...options[0] } },
    ] });
    service.close(conversationId);
  });

  it('rejects malformed, ambiguous or unbounded structured question options while retaining legacy free-text questions', () => {
    const service = configuredService();
    const testable = service as unknown as TestableAgentWsService;
    testable.sessions.set(conversationId, session(socketStub()));
    const received = jest.fn();
    service.onMessage(conversationId, received);
    const option = { id: 'topic', label: 'Математика' };
    const question = { type: 'question', isFinal: false, content: { kind: 'question', label: 'Выберите тему' } };
    for (const options of [undefined, null, [], [option]]) {
      testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify({ ...question, content: { ...question.content, options } })));
    }
    expect(received).toHaveBeenCalledTimes(4);
    for (const options of [
      [{}], [{ ...option, id: ' ' }], [{ ...option, label: ' ' }], [{ ...option, id: 'a'.repeat(129) }],
      [{ ...option, label: 'a'.repeat(501) }], [option, { ...option, label: 'Физика' }],
      [option, { id: 'other', label: ' МАТЕМАТИКА ' }],
      Array.from({ length: 9 }, (_, i) => ({ id: String(i), label: String(i) })),
    ]) testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify({ ...question, content: { ...question.content, options } })));
    for (const label of [' ', 'a'.repeat(4001)]) {
      testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify({ ...question, content: { ...question.content, label } })));
    }
    expect(received).toHaveBeenCalledTimes(4);
    service.close(conversationId);
  });

  it.each([false, true])('dispatches an explicit retry once, then reconnects readonly (queued=%s)', (queued) => {
    const service = configuredService();
    const testable = service as unknown as TestableAgentWsService;
    const ws = socketStub();
    if (queued) Object.assign(ws, { readyState: WebSocket.CONNECTING });
    const state = session(ws);
    testable.sessions.set(conversationId, state);
    const requestId = '22222222-2222-4222-8222-222222222222';
    const retry = { ...init, requestId, attempt: 2, resume: true,
      history: [{ id: requestId, role: 'user' as const, content: { kind: 'text' as const, label: 'Retry me' } }] };
    service.send(conversationId, retry);
    if (queued) {
      Object.assign(ws, { readyState: WebSocket.OPEN });
      testable.onSocketOpen(conversationId);
    }
    expect(JSON.parse(ws.send.mock.calls[0][0] as string)).toEqual(retry);
    const received = jest.fn();
    service.onMessage(conversationId, received);
    testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify({ type: AgentMessageType.Message, isFinal: false,
      requestId, attempt: 1, content: { kind: 'text', label: 'Stale answer' } })));
    expect(received).not.toHaveBeenCalled();
    state.openedOnce = true;
    ws.send.mockClear();
    testable.onSocketOpen(conversationId);
    expect(JSON.parse(ws.send.mock.calls[0][0] as string)).toEqual({ ...retry, resume: false });
    expect(state.lastInit?.history).toHaveLength(1);
    service.close(conversationId);
  });

  it('preserves turn identity through normalized recommendations/results and readonly reconnect history', () => {
    const service = configuredService();
    const testable = service as unknown as TestableAgentWsService;
    const ws = socketStub();
    const state = session(ws);
    testable.sessions.set(conversationId, state);
    service.send(conversationId, { ...init, resume: false });
    const requestId = '22222222-2222-4222-8222-222222222222';
    service.send(conversationId, { type: 'message', requestId, attempt: 1, content: { kind: 'text', label: 'Вопрос' } });
    expect(state.lastInit?.history[0].id).toBe(requestId);
    const received = jest.fn();
    service.onMessage(conversationId, received);
    for (const content of [
      { type: AgentMessageType.Recommendations, content: { kind: 'recommendations', label: 'Найдены тесты', benchmarks: [] } },
      { type: AgentMessageType.Result, content: { kind: 'result', label: 'Результат', status: 'done' } },
    ]) {
      testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify({ ...content, isFinal: false, requestId, attempt: 1 })));
      expect(received).toHaveBeenLastCalledWith(expect.objectContaining({ requestId, attempt: 1 }));
    }
    const count = received.mock.calls.length;
    testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify({ type: AgentMessageType.Error, isFinal: true,
      requestId, content: { message: 'Missing attempt' } })));
    expect(received).toHaveBeenCalledTimes(count);
    state.openedOnce = true;
    ws.send.mockClear();
    testable.onSocketOpen(conversationId);
    expect(JSON.parse(ws.send.mock.calls[0][0] as string)).toMatchObject({ resume: false,
      history: expect.arrayContaining([expect.objectContaining({ id: requestId })]) });
    service.close(conversationId);
  });

  it('acknowledges persisted output IDs and translates nested recommendation history for replay', () => {
    const service = configuredService();
    const testable = service as unknown as TestableAgentWsService;
    const ws = socketStub();
    const state = session(ws);
    testable.sessions.set(conversationId, state);
    service.send(conversationId, init);
    const eventId = '22222222-2222-4222-8222-222222222222';
    const received = jest.fn();
    service.onMessage(conversationId, received);
    const payload = { type: AgentMessageType.Recommendations, isFinal: false, eventId,
      content: { kind: 'recommendations', label: 'Нашёл подходящий тест',
        benchmarks: [{ benchmarkId: 'remote-test', explanation: 'Fits' }] } };
    testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify(payload)));
    expect(received).toHaveBeenCalledWith({ ...payload, content: { ...payload.content,
      benchmarks: [{ testId: 'remote-test', explanation: 'Fits' }] } });
    expect(state.lastInit?.history[0].id).toBeUndefined();
    service.acknowledgeMessage(conversationId, eventId);
    expect(state.lastInit?.history[0].id).toBe(eventId);
    testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify(payload)));
    expect(state.lastInit?.history).toHaveLength(1);
    state.openedOnce = true;
    ws.send.mockClear();
    testable.onSocketOpen(conversationId);
    expect(JSON.parse(ws.send.mock.calls[0][0] as string).history).toEqual([
      { id: eventId, role: 'agent', content: payload.content },
    ]);
    service.close(conversationId);
  });

  it('preserves stable IDs for text, generation results and hypotheses and rejects malformed frames', () => {
    const service = configuredService();
    const testable = service as unknown as TestableAgentWsService;
    testable.sessions.set(conversationId, session(socketStub()));
    const received = jest.fn();
    service.onMessage(conversationId, received);
    const eventId = '22222222-2222-4222-8222-222222222222';
    for (const payload of [
      { type: AgentMessageType.Message, isFinal: false, eventId, content: { kind: 'text', label: 'Hello' } },
      { type: AgentMessageType.Result, isFinal: false, eventId, content: { kind: 'result', label: 'Working', status: 'generating', generationJobId: eventId } },
      { type: AgentMessageType.Hypotheses, isFinal: false, eventId, content: { kind: 'hypotheses', hypotheses: ['one'], testId: 'remote-test' } },
    ]) {
      testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify(payload)));
      expect(received).toHaveBeenLastCalledWith(payload);
    }
    for (const invalid of [
      { type: AgentMessageType.Message, isFinal: false, eventId: 'invalid', content: { kind: 'text', label: 'Hello' } },
      { type: AgentMessageType.Message, isFinal: true, content: { kind: 'text', label: 'Hello' } },
      { type: AgentMessageType.Recommendations, isFinal: false, content: { kind: 'recommendations', label: 'Card', benchmarks: [{ benchmarkId: 5 }] } },
    ]) testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify(invalid)));
    expect(received).toHaveBeenCalledTimes(3);
    service.close(conversationId);
  });
  it('maps Test IDs only on the Factory wire and replays current history after reconnect', () => {
    const service = configuredService();
    const testable = service as unknown as TestableAgentWsService;
    const ws = socketStub();
    const state = session(ws);
    testable.sessions.set(conversationId, state);
    service.send(conversationId, { ...init, history: [{ role: 'user', content: {
      kind: 'recommendation_rejected', testId: 'test-id',
    } }] });
    expect(JSON.parse(ws.send.mock.calls[0][0] as string).history[0].content)
      .toEqual({ kind: 'recommendation_rejected', benchmarkId: 'test-id' });
    service.send(conversationId, { type: 'message', content: {
      kind: 'recommendation_selected', testId: 'second-test',
    } });
    testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify({
      type: AgentMessageType.Question, isFinal: false,
      content: { kind: 'question', label: 'Next?', questionKey: 'goal', interviewState: { topic: 'medicine' } },
    })));
    expect(state.lastInit?.history[0].content).toEqual({ kind: 'recommendation_rejected', testId: 'test-id' });
    state.openedOnce = true;
    ws.send.mockClear();
    testable.onSocketOpen(conversationId);
    expect(JSON.parse(ws.send.mock.calls[0][0] as string).history).toEqual([
      { role: 'user', content: { kind: 'recommendation_rejected', benchmarkId: 'test-id' } },
      { role: 'user', content: { kind: 'recommendation_selected', benchmarkId: 'second-test' } },
      { role: 'agent', content: { kind: 'question', label: 'Next?', questionKey: 'goal', interviewState: { topic: 'medicine' } } },
    ]);
    service.close(conversationId);
  });

  it('sends saved init before messages queued during reconnect', () => {
    const service = configuredService();
    const testable = service as unknown as TestableAgentWsService;
    const socket = socketStub();
    jest.spyOn(testable, 'startHeartbeat').mockImplementation(() => undefined);

    testable.sessions.set(
      conversationId,
      session(socket, {
        openedOnce: true,
        lastInit: init,
        pending: [
          {
            type: 'message',
            content: { kind: 'text', label: 'Продолжение интервью' },
          },
        ],
        pendingBytes: 100,
      })
    );

    testable.onSocketOpen(conversationId);

    expect(
      socket.send.mock.calls.map(([payload]) => JSON.parse(payload as string))
    ).toEqual([
      init,
      {
        type: 'message',
        content: { kind: 'text', label: 'Продолжение интервью' },
      },
    ]);
    expect(testable.sessions.get(conversationId)?.pendingBytes).toBe(0);
    service.close(conversationId);
  });

  it('does not duplicate init on the first socket opening', () => {
    const service = configuredService();
    const testable = service as unknown as TestableAgentWsService;
    const socket = socketStub();
    jest.spyOn(testable, 'startHeartbeat').mockImplementation(() => undefined);

    testable.sessions.set(
      conversationId,
      session(socket, {
        openedOnce: false,
        lastInit: init,
        pending: [init],
        pendingBytes: Buffer.byteLength(JSON.stringify(init)),
      })
    );

    testable.onSocketOpen(conversationId);

    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socket.send.mock.calls[0]?.[0] as string)).toEqual(init);
    service.close(conversationId);
  });
});

describe('AgentWsService reconnect failure budget', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it.each([1003, 1007, 1008])('ends a rejected session on close code %s without retrying', (code) => {
    const service = configuredService();
    const testable = service as unknown as TestableAgentWsService;
    const reconnect = jest.spyOn(testable, 'openSocket').mockImplementation(() => undefined);
    const state = session(socketStub(), { pending: [init], pendingBytes: 100 });
    testable.sessions.set(conversationId, state);
    const received = jest.fn();
    service.onMessage(conversationId, received);

    testable.onSocketClose(conversationId, code);
    jest.advanceTimersByTime(1_000);

    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith({ type: AgentMessageType.Error, isFinal: true,
      content: { message: 'Сервис интервью отклонил соединение. Попробуйте позже.' } });
    expect(reconnect).not.toHaveBeenCalled();
    expect(service.getLoadSnapshot()).toMatchObject({ activeSessions: 0, pendingBytes: 0 });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('resets retry attempts only after a new validated application message', () => {
    const service = configuredService();
    const testable = service as unknown as TestableAgentWsService;
    const eventId = '22222222-2222-4222-8222-222222222222';
    const state = session(socketStub(), { reconnectAttempt: 2, openedOnce: true,
      lastInit: { ...init, history: [{ id: eventId, role: 'agent', content: questionPayload('Previous').content }] } });
    testable.sessions.set(conversationId, state);
    testable.onSocketOpen(conversationId);
    testable.onPong(conversationId);
    for (const raw of ['invalid-json', '{}', JSON.stringify({ type: AgentMessageType.Error,
      isFinal: true, content: { message: 'upstream error' } }),
    JSON.stringify({ ...questionPayload('Previous'), eventId })]) {
      testable.onSocketMessage(conversationId, Buffer.from(raw));
    }
    expect(state.reconnectAttempt).toBe(2);
    testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify(questionPayload('Next'))));
    expect(state.reconnectAttempt).toBe(0);
    testable.onSocketClose(conversationId, 1006);
    expect(state.reconnectAttempt).toBe(1);
    expect(state.reconnectTimer).not.toBeNull();
    service.close(conversationId);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('AgentWsService real WebSocket recovery', () => {
  let server: WebSocketServer;
  let service: AgentWsService;

  beforeEach(async () => {
    server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    service = configuredService({ wsUrl: `ws://127.0.0.1:${(server.address() as AddressInfo).port}` });
  });

  afterEach(async () => {
    await service?.onModuleDestroy();
    for (const ws of server.clients) ws.terminate();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it.each([1003, 1007, 1008])('reports a safe error for server rejection %s without a reconnect loop', async (code) => {
    let connections = 0;
    server.on('connection', (ws) => {
      connections += 1;
      ws.once('message', () => ws.close(code, 'sensitive remote rejection reason'));
    });
    const received = await finalError();
    expect(received).toEqual({ type: AgentMessageType.Error, isFinal: true,
      content: { message: 'Сервис интервью отклонил соединение. Попробуйте позже.' } });
    expect(connections).toBe(1);
    expect(service.getLoadSnapshot().activeSessions).toBe(0);
  });

  it('exhausts retries even when each handshake opens and sends pong or malformed frames', async () => {
    const receivedInit: unknown[] = [];
    server.on('connection', (ws) => {
      ws.once('message', (raw) => {
        const buffer = Array.isArray(raw) ? Buffer.concat(raw)
          : raw instanceof ArrayBuffer ? Buffer.from(raw) : raw;
        receivedInit.push(JSON.parse(buffer.toString('utf-8')));
        ws.pong();
        ws.send('invalid-json');
        ws.send(JSON.stringify({ type: 'question', content: 'malformed' }));
        ws.close(1000, 'rejected after handshake');
      });
    });
    expect(await finalError()).toEqual({ type: AgentMessageType.Error, isFinal: true,
      content: { message: 'Interviewer connection failed after all reconnect attempts' } });
    expect(receivedInit).toEqual([init, { ...init, resume: false }, { ...init, resume: false }]);
    expect(service.getLoadSnapshot().activeSessions).toBe(0);
  });

  it('ignores old socket callbacks after a replacement socket or session is installed', async () => {
    const testable = service as unknown as TestableAgentWsService;
    service.connect(conversationId);
    const oldState = testable.sessions.get(conversationId)!;
    const oldSocket = oldState.ws!;
    await once(oldSocket, 'open');
    const staleCallbacks = Object.fromEntries(['open', 'message', 'pong', 'close'].map((event) =>
      [event, oldSocket.listeners(event)]));
    for (const replaceSession of [false, true]) {
      const newSocket = socketStub();
      const current = replaceSession ? session(newSocket) : oldState;
      current.ws = newSocket;
      current.pending = [init];
      current.pendingBytes = 100;
      current.reconnectAttempt = 2;
      current.heartbeatTimeout = setTimeout(() => undefined, 10_000);
      const heartbeatTimeout = current.heartbeatTimeout;
      testable.sessions.set(conversationId, current);
      const received = jest.fn();
      service.onMessage(conversationId, received);
      for (const callback of staleCallbacks.open) callback();
      for (const callback of staleCallbacks.message) callback(Buffer.from(JSON.stringify(questionPayload('Stale'))));
      for (const callback of staleCallbacks.pong) callback();
      for (const callback of staleCallbacks.close) callback(1008, Buffer.from('old rejection'));
      expect(testable.sessions.get(conversationId)).toBe(current);
      expect(current.ws).toBe(newSocket);
      expect(current.reconnectAttempt).toBe(2);
      expect(current.heartbeatTimeout).toBe(heartbeatTimeout);
      expect(current.pending).toEqual([init]);
      expect(newSocket.send).not.toHaveBeenCalled();
      expect(received).not.toHaveBeenCalled();
      if (!replaceSession) service.close(conversationId);
    }
    oldSocket.terminate();
  });

  async function finalError(): Promise<unknown> {
    let deadline: NodeJS.Timeout | undefined;
    try {
      return await new Promise((resolve, reject) => {
        deadline = setTimeout(() => reject(new Error('Timed out waiting for terminal session error')), 2_000);
        service.connect(conversationId);
        service.onMessage(conversationId, (payload) => {
          if (payload.type === AgentMessageType.Error) resolve(payload);
        });
        service.send(conversationId, init);
      });
    } finally {
      clearTimeout(deadline);
    }
  }
});

describe('AgentWsService overload protection', () => {
  it('fails fast above the configured active session limit', () => {
    const service = configuredService({ maxActiveSessions: 2 });
    const testable = service as unknown as TestableAgentWsService;
    jest.spyOn(testable, 'openSocket').mockImplementation(() => undefined);

    service.connect('conversation-1');
    service.connect('conversation-2');

    expect(() => service.connect('conversation-3')).toThrow(
      ServiceUnavailableException
    );
    expect(service.getLoadSnapshot()).toEqual({
      activeSessions: 2,
      pendingMessages: 0,
      pendingBytes: 0,
      maxActiveSessions: 2,
    });

    service.close('conversation-1');
    service.close('conversation-2');
  });

  it('bounds the number of messages waiting for socket open', () => {
    const service = configuredService({
      maxPendingMessagesPerSession: 2,
      maxBufferedBytesPerSession: 10_000,
    });
    const testable = service as unknown as TestableAgentWsService;
    jest.spyOn(testable, 'openSocket').mockImplementation(() => undefined);
    service.connect(conversationId);

    service.send(conversationId, init);
    service.send(conversationId, {
      type: 'message',
      content: { kind: 'text', label: 'one' },
    });

    expect(() =>
      service.send(conversationId, {
        type: 'message',
        content: { kind: 'text', label: 'two' },
      })
    ).toThrow(ServiceUnavailableException);
    expect(service.getLoadSnapshot().pendingMessages).toBe(0);
    expect(service.getLoadSnapshot().activeSessions).toBe(0);
  });

  it('rejects an oversized payload before buffering it', () => {
    const service = configuredService({
      maxPayloadBytes: 100,
      maxBufferedBytesPerSession: 1_000,
    });
    const testable = service as unknown as TestableAgentWsService;
    jest.spyOn(testable, 'openSocket').mockImplementation(() => undefined);
    service.connect(conversationId);

    expect(() =>
      service.send(conversationId, {
        type: 'message',
        content: { kind: 'text', label: 'x'.repeat(200) },
      })
    ).toThrow(PayloadTooLargeException);
    expect(service.getLoadSnapshot().pendingMessages).toBe(0);
    expect(service.getLoadSnapshot().activeSessions).toBe(0);
  });

  it('rejects writes when the native socket buffer is congested', () => {
    const service = configuredService({
      maxPayloadBytes: 1_000,
      maxBufferedBytesPerSession: 1_000,
    });
    const testable = service as unknown as TestableAgentWsService;
    const socket = socketStub({
      readyState: WebSocket.OPEN,
      bufferedAmount: 990,
    });
    testable.sessions.set(conversationId, session(socket));

    expect(() => service.send(conversationId, init)).toThrow(
      ServiceUnavailableException
    );
    expect(socket.send).not.toHaveBeenCalled();
    expect(service.getLoadSnapshot().activeSessions).toBe(0);
  });

  it('closes an inactive session and reports a final transport error', () => {
    jest.useFakeTimers();
    const service = configuredService({ sessionIdleTimeoutMs: 50 });
    const testable = service as unknown as TestableAgentWsService;
    jest.spyOn(testable, 'openSocket').mockImplementation(() => undefined);
    const received = jest.fn();
    service.connect(conversationId);
    service.onMessage(conversationId, received);

    jest.advanceTimersByTime(50);

    expect(received).toHaveBeenCalledWith({
      type: AgentMessageType.Error,
      isFinal: true,
      content: {
        message: 'Interviewer session closed after inactivity timeout',
      },
    });
    expect(service.getLoadSnapshot().activeSessions).toBe(0);
    jest.useRealTimers();
  });
});

describe('AgentWsService message delivery', () => {
  it('replaces a stale consumer instead of multiplying message handling', () => {
    const service = configuredService();
    const testable = service as unknown as TestableAgentWsService;
    testable.sessions.set(conversationId, session(socketStub()));
    const stale = jest.fn();
    const current = jest.fn();
    service.onMessage(conversationId, stale);
    service.onMessage(conversationId, current);

    testable.onSocketMessage(
      conversationId,
      Buffer.from(JSON.stringify(questionPayload('Актуальный вопрос')))
    );

    expect(stale).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledTimes(1);
    service.close(conversationId);
  });

  it('accepts hypotheses and explicit error payloads from Interviewer', () => {
    const service = configuredService();
    const testable = service as unknown as TestableAgentWsService;
    testable.sessions.set(conversationId, session(socketStub()));
    const received = jest.fn();
    service.onMessage(conversationId, received);

    const legacyHypotheses = {
      type: AgentMessageType.Hypotheses,
      isFinal: false,
      content: {
        kind: 'hypotheses' as const,
        benchmarkId: 'test-id',
        hypotheses: ['one', 'two'],
      },
    };
    const error = {
      type: AgentMessageType.Error,
      isFinal: true as const,
      content: { message: 'upstream overloaded' },
    };
    testable.onSocketMessage(
      conversationId,
      Buffer.from(JSON.stringify(legacyHypotheses))
    );
    testable.onSocketMessage(
      conversationId,
      Buffer.from(JSON.stringify(error))
    );

    expect(received.mock.calls.map(([payload]) => payload)).toEqual([
      {
        type: AgentMessageType.Hypotheses,
        isFinal: false,
        content: {
          kind: 'hypotheses',
          testId: 'test-id',
          hypotheses: ['one', 'two'],
        },
      },
      error,
    ]);
    service.close(conversationId);
  });

  it('preserves valid question state and generation handoff through the bounded WS transport', () => {
    const service = configuredService();
    const testable = service as unknown as TestableAgentWsService;
    testable.sessions.set(conversationId, session(socketStub()));
    const received = jest.fn();
    service.onMessage(conversationId, received);
    const question = { type: AgentMessageType.Question, isFinal: false, content: {
      kind: 'question', label: 'Next?', questionKey: 'goal', interviewState: { domain: 'medicine' },
    } };
    const result = { type: AgentMessageType.Result, isFinal: false, content: {
      kind: 'result', label: 'Working', status: 'generating', generationJobId: '14a2b43e-8935-4077-a30e-635f708d904f',
    } };
    for (const payload of [question, result]) {
      testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify(payload)));
      expect(received).toHaveBeenLastCalledWith(payload);
    }
    for (const invalid of [
      { ...question, content: { ...question.content, interviewState: { domain: 123 } } },
      { ...question, content: { ...question.content, questionKey: {} } },
      { ...result, content: { ...result.content, generationJobId: 123 } },
    ]) testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify(invalid)));
    expect(received).toHaveBeenCalledTimes(2);
    service.close(conversationId);
  });

  it('rejects a result with an unknown business status', () => {
    const service = configuredService();
    const testable = service as unknown as TestableAgentWsService;
    testable.sessions.set(conversationId, session(socketStub()));
    const received = jest.fn();
    service.onMessage(conversationId, received);

    testable.onSocketMessage(
      conversationId,
      Buffer.from(
        JSON.stringify({
          type: AgentMessageType.Result,
          isFinal: true,
          content: {
            kind: 'result',
            label: 'invalid',
            status: 'partially_done',
          },
        })
      )
    );

    expect(received).not.toHaveBeenCalled();
    service.close(conversationId);
  });

  it('preserves terminal brief_ready without a job and rejects fake execution IDs', () => {
    const service = configuredService();
    const testable = service as unknown as TestableAgentWsService;
    testable.sessions.set(conversationId, session(socketStub()));
    const received = jest.fn();
    service.onMessage(conversationId, received);
    const prepared = { type: AgentMessageType.Result, isFinal: true,
      content: { kind: 'result', label: 'Оставьте контакты — пришлём результат позже.', status: 'brief_ready' } };
    testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify(prepared)));
    expect(received).toHaveBeenCalledWith(prepared);
    for (const invalid of [
      { ...prepared, isFinal: false },
      { ...prepared, content: { ...prepared.content, generationJobId: conversationId } },
      { ...prepared, content: { ...prepared.content, testId: 'fake-result' } },
    ]) testable.onSocketMessage(conversationId, Buffer.from(JSON.stringify(invalid)));
    expect(received).toHaveBeenCalledTimes(1);
    service.close(conversationId);
  });

  it('emits canonical testId for canonical and legacy result payloads', () => {
    const service = configuredService();
    const testable = service as unknown as TestableAgentWsService;
    testable.sessions.set(conversationId, session(socketStub()));
    const received = jest.fn();
    service.onMessage(conversationId, received);

    for (const content of [
      { kind: 'result', label: 'canonical', status: 'done', testId: 'test-1' },
      { kind: 'result', label: 'legacy', status: 'finished', benchmarkId: 'test-2' },
      { kind: 'result', label: 'draft', status: 'done' },
    ]) {
      testable.onSocketMessage(
        conversationId,
        Buffer.from(JSON.stringify({
          type: AgentMessageType.Result,
          isFinal: true,
          content,
        }))
      );
    }

    expect(received.mock.calls.map(([payload]) => payload.content)).toEqual([
      { kind: 'result', label: 'canonical', status: 'done', testId: 'test-1' },
      { kind: 'result', label: 'legacy', status: 'finished', testId: 'test-2' },
      { kind: 'result', label: 'draft', status: 'done' },
    ]);
    service.close(conversationId);
  });

  it.each([
    [AgentMessageType.Result, {
      kind: 'result', label: 'bad result', status: 'done', testId: 42,
    }],
    [AgentMessageType.Hypotheses, {
      kind: 'hypotheses', hypotheses: ['one'], benchmarkId: 42,
    }],
  ])('rejects a malformed Test target in %s payload', (type, content) => {
    const service = configuredService();
    const testable = service as unknown as TestableAgentWsService;
    testable.sessions.set(conversationId, session(socketStub()));
    const received = jest.fn();
    service.onMessage(conversationId, received);

    testable.onSocketMessage(
      conversationId,
      Buffer.from(JSON.stringify({ type, isFinal: false, content }))
    );

    expect(received).not.toHaveBeenCalled();
    service.close(conversationId);
  });
});

describe('AgentWsService concurrent socket smoke', () => {
  it('opens and cleans up many independent session lifecycles', async () => {
    const sessionCount = 32;
    const service = configuredService({
      maxActiveSessions: sessionCount,
    });
    const testable = service as unknown as TestableAgentWsService;
    jest.spyOn(testable, 'openSocket').mockImplementation(() => undefined);

    for (let index = 0; index < sessionCount; index += 1) {
      service.connect(`conversation-${index}`);
    }

    expect(service.getLoadSnapshot().activeSessions).toBe(sessionCount);
    await service.onModuleDestroy();
    expect(service.getLoadSnapshot().activeSessions).toBe(0);
  });
});

function configuredService(
  overrides: Partial<AgentEnvType> = {}
): AgentWsService {
  const config: AgentEnvType = {
    mode: 'ws',
    wsUrl: 'ws://127.0.0.1:65535',
    apiKey: '',
    maxActiveSessions: 200,
    maxPendingMessagesPerSession: 32,
    maxBufferedBytesPerSession: 1_048_576,
    maxPayloadBytes: 1_048_576,
    sessionIdleTimeoutMs: 30_000,
    reconnectInitialDelayMs: 10,
    reconnectMaxDelayMs: 20,
    reconnectMaxAttempts: 2,
    heartbeatIntervalMs: 25_000,
    heartbeatTimeoutMs: 10_000,
    ...overrides,
  };
  const configService = {
    getOrThrow: jest.fn().mockReturnValue(config),
  } as unknown as ConfigService;
  const service = new AgentWsService(configService);
  service.onModuleInit();
  return service;
}

function socketStub(
  overrides: Partial<Pick<WebSocket, 'readyState' | 'bufferedAmount'>> = {}
): WebSocket & { send: jest.Mock } {
  return {
    send: jest.fn(),
    close: jest.fn(),
    terminate: jest.fn(),
    removeAllListeners: jest.fn(),
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    ...overrides,
  } as unknown as WebSocket & { send: jest.Mock };
}

function session(
  socket: WebSocket,
  overrides: Partial<SessionState> = {}
): SessionState {
  return {
    ws: socket,
    emitter: new EventEmitter(),
    pending: [],
    pendingBytes: 0,
    lastInit: null,
    openedOnce: false,
    reconnectAttempt: 0,
    reconnectTimer: null,
    heartbeatInterval: null,
    heartbeatTimeout: null,
    idleTimeout: null,
    closedByUser: false,
    ...overrides,
  };
}

function questionPayload(label: string) {
  return {
    type: AgentMessageType.Question,
    isFinal: false,
    content: { kind: 'question', label },
  } as const;
}
