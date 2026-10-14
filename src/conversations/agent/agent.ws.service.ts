import { EventEmitter } from 'events';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket, { type RawData } from 'ws';
import { AgentMessageType } from '@/common/enums/agentMessageType.enum';
import type {
  AgentInitPayload,
  AgentMessagePayload,
  AgentOutgoingPayload,
  HistoryEntry,
} from '../types';
import type {
  AgentMessageCallback,
  IAgentService,
} from './agent.service.interface';
import type { AgentEnvType } from '@/configs/types';

export type SessionState = {
  ws: Nullable<WebSocket>;
  emitter: EventEmitter;
  /** буфер сообщений, отправленных до открытия соединения */
  pending: AgentOutgoingPayload[];
  /** размер pending в UTF-8 байтах, чтобы очередь была ограничена не только числом */
  pendingBytes: number;
  /** Последний init нужен для восстановления контекста на новом WS. */
  lastInit: AgentInitPayload | null;
  /** Отличает первое открытие сокета от сетевого reconnect. */
  openedOnce: boolean;
  /** счётчик неудачных попыток подключения */
  reconnectAttempt: number;
  /** таймер на следующую попытку reconnect */
  reconnectTimer: Nullable<NodeJS.Timeout>;
  /** интервал heartbeat ping */
  heartbeatInterval: Nullable<NodeJS.Timeout>;
  /** таймер ожидания pong */
  heartbeatTimeout: Nullable<NodeJS.Timeout>;
  /** закрывает забытые интерактивные сессии без активности */
  idleTimeout: Nullable<NodeJS.Timeout>;
  /** флаг — пользователь сам закрыл сессию, reconnect не нужен */
  closedByUser: boolean;
};

@Injectable()
export class AgentWsService
implements IAgentService, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentWsService.name);
  private readonly sessions = new Map<string, SessionState>();
  private readonly unpersisted = new Map<string, Map<string, HistoryEntry>>();
  private agentConfig!: AgentEnvType;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.agentConfig = this.configService.getOrThrow<AgentEnvType>('agent');

    if ('ws' === this.agentConfig.mode && !this.agentConfig.wsUrl) {
      this.logger.warn(
        'THIRD_PARTY_WS_URL is not set — AgentWsService will fail on connect()'
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const conversationId of Array.from(this.sessions.keys())) {
      this.close(conversationId);
    }
    // даём ws чуть-чуть времени корректно закрыться
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // ----------------------------------------------------------------------
  //  IAgentService
  // ----------------------------------------------------------------------

  connect(conversationId: string): void {
    if (this.sessions.has(conversationId)) {
      this.logger.warn(
        `WS session already exists for conversationId="${conversationId}"`
      );
      return;
    }

    if (!this.agentConfig.wsUrl) {
      throw new ServiceUnavailableException(
        'Interviewer WebSocket is not configured'
      );
    }

    if (this.sessions.size >= this.agentConfig.maxActiveSessions) {
      this.logger.warn(
        'Interviewer capacity exhausted: ' +
        `activeSessions=${this.sessions.size}, ` +
        `limit=${this.agentConfig.maxActiveSessions}`
      );
      throw new ServiceUnavailableException(
        'Interviewer is at capacity; retry later'
      );
    }

    const session: SessionState = {
      ws: null,
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
    };

    this.sessions.set(conversationId, session);
    this.resetIdleTimeout(conversationId);
    this.openSocket(conversationId);
  }

  onMessage(
    conversationId: string,
    callback: AgentMessageCallback
  ): void {
    const session = this.sessions.get(conversationId);
    if (!session) {
      this.logger.warn(
        `Cannot subscribe — no WS session for conversationId="${conversationId}"`
      );
      return;
    }
    // У conversation ровно один актуальный потребитель. При reconnect браузера
    // заменяем callback, иначе один ответ Interviewer обрабатывается N раз.
    session.emitter.removeAllListeners('message');
    session.emitter.on('message', callback);
  }

  send(conversationId: string, data: AgentOutgoingPayload): void {
    const session = this.sessions.get(conversationId);
    if (!session || session.closedByUser) {
      this.logger.warn(
        `Cannot send — no active WS session for conversationId="${conversationId}"`
      );
      return;
    }

    let serialized: string;
    try {
      serialized = this.serializePayload(data);
    } catch (error) {
      this.failSession(conversationId, this.errorMessage(error));
      throw error;
    }

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      try {
        this.assertTransportCapacity(session.ws, serialized, conversationId);
        this.rawSend(session.ws, serialized, conversationId);
      } catch (error) {
        this.failSession(conversationId, this.errorMessage(error));
        throw error;
      }
      if ('init' === data.type) session.lastInit = data;
      if ('message' === data.type) {
        this.rememberHistory(conversationId, { role: 'user', content: data.content });
      }
      this.resetIdleTimeout(conversationId);
      return;
    }

    // CONNECTING / CLOSING / null — кладём в буфер, отправим на 'open'
    const payloadBytes = Buffer.byteLength(serialized);
    if (
      session.pending.length >=
        this.agentConfig.maxPendingMessagesPerSession ||
      session.pendingBytes + payloadBytes >
        this.agentConfig.maxBufferedBytesPerSession
    ) {
      this.logger.warn(
        'Interviewer pending queue exhausted: ' +
        `conversationId="${conversationId}", ` +
        `messages=${session.pending.length}, bytes=${session.pendingBytes}`
      );
      const error = new ServiceUnavailableException(
        'Interviewer session queue is full; retry later'
      );
      this.failSession(conversationId, error.message);
      throw error;
    }

    session.pending.push(data);
    session.pendingBytes += payloadBytes;
    if ('init' === data.type) session.lastInit = data;
    this.resetIdleTimeout(conversationId);
  }

  getLoadSnapshot(): {
    activeSessions: number;
    pendingMessages: number;
    pendingBytes: number;
    maxActiveSessions: number;
  } {
    let pendingMessages = 0;
    let pendingBytes = 0;
    for (const session of this.sessions.values()) {
      pendingMessages += session.pending.length;
      pendingBytes += session.pendingBytes;
    }

    return {
      activeSessions: this.sessions.size,
      pendingMessages,
      pendingBytes,
      maxActiveSessions: this.agentConfig.maxActiveSessions,
    };
  }

  close(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (!session) {
      this.logger.debug(
        `close() called for unknown or already closed session: conversationId="${conversationId}"`
      );
      return;
    }

    session.closedByUser = true;
    this.clearTimers(session);
    session.emitter.removeAllListeners();

    if (session.ws) {
      try {
        session.ws.removeAllListeners();
        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.close(1000, 'client_closed');
        } else if (session.ws.readyState === WebSocket.CONNECTING) {
          // ws emits an Error when a handshake is aborted. Keep a terminal
          // listener so application shutdown cannot produce an unhandled event.
          session.ws.once('error', () => undefined);
          session.ws.terminate();
        }
      } catch (error) {
        this.logger.warn(
          `Error while closing WS for conversationId="${conversationId}": ${this.errorMessage(error)}`
        );
      }
    }

    this.sessions.delete(conversationId);
    this.unpersisted.delete(conversationId);
    this.logger.log(`WS session closed: conversationId="${conversationId}"`);
  }

  acknowledgeMessage(conversationId: string, eventId: string): void {
    const received = this.unpersisted.get(conversationId);
    const entry = received?.get(eventId);
    if (entry) entry.id = eventId;
    received?.delete(eventId);
    if (0 === received?.size) this.unpersisted.delete(conversationId);
  }

  // ----------------------------------------------------------------------
  //  internals
  // ----------------------------------------------------------------------

  private openSocket(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (!session || session.closedByUser) return;

    const url = this.agentConfig.wsUrl;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url, {
        headers: this.agentConfig.apiKey
          ? { Authorization: `Bearer ${this.agentConfig.apiKey}` }
          : undefined,
        handshakeTimeout: 10_000,
        maxPayload: this.agentConfig.maxPayloadBytes,
        perMessageDeflate: false,
      });
    } catch (error) {
      this.logger.error(
        `WS constructor failed for conversationId="${conversationId}": ${this.errorMessage(error)}`
      );
      this.scheduleReconnect(conversationId);
      return;
    }

    session.ws = ws;

    const isCurrentSocket = () => this.sessions.get(conversationId) === session &&
      session.ws === ws && !session.closedByUser;
    ws.on('open', () => {
      if (isCurrentSocket()) this.onSocketOpen(conversationId);
    });
    ws.on('message', (raw) => {
      if (isCurrentSocket()) this.onSocketMessage(conversationId, raw);
    });
    ws.on('pong', () => {
      if (isCurrentSocket()) this.onPong(conversationId);
    });
    ws.on('error', (err) => {
      if (!isCurrentSocket()) return;
      this.logger.warn(
        `WS error for conversationId="${conversationId}": ${this.errorMessage(err)}`
      );
    });
    ws.on('close', (code) => {
      if (isCurrentSocket()) this.onSocketClose(conversationId, code);
    });
  }

  private onSocketOpen(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (!session || !session.ws) return;

    this.logger.log(`WS open: conversationId="${conversationId}"`);
    this.resetIdleTimeout(conversationId);

    const isReconnect = session.openedOnce;
    session.openedOnce = true;

    // Новое физическое соединение не знает состояния старого. Сначала
    // восстанавливаем init/history, затем отправляем накопленные user messages.
    const hasPendingInit = session.pending.some(
      (payload) => 'init' === payload.type
    );
    if (isReconnect && session.lastInit && !hasPendingInit) {
      if (!this.tryRawSend(session.ws, session.lastInit, conversationId)) {
        return;
      }
    }

    // flush буфер
    const drained = session.pending.splice(0, session.pending.length);
    session.pendingBytes = 0;
    for (const payload of drained) {
      if (!this.tryRawSend(session.ws, payload, conversationId)) return;
      if ('message' === payload.type) {
        if (!this.rememberHistory(conversationId, { role: 'user', content: payload.content })) return;
      }
    }

    this.startHeartbeat(conversationId);
  }

  private onSocketMessage(conversationId: string, raw: RawData): void {
    const session = this.sessions.get(conversationId);
    if (!session) return;

    let parsed: unknown;
    try {
      const buffer = Array.isArray(raw)
        ? Buffer.concat(raw)
        : raw instanceof ArrayBuffer
          ? Buffer.from(raw)
          : raw;
      const text = buffer.toString('utf-8');
      parsed = JSON.parse(text);
    } catch (error) {
      this.logger.warn(
        `WS payload parse failed for conversationId="${conversationId}": ${this.errorMessage(error)}`
      );
      return;
    }

    const payload = this.parseAgentMessagePayload(parsed);
    if (!payload) {
      this.logger.warn(
        `WS payload invalid shape for conversationId="${conversationId}"`
      );
      return;
    }

    const isReplay = Boolean(payload.eventId && (
      session.lastInit?.history.some((entry) => entry.id === payload.eventId) ||
      this.unpersisted.get(conversationId)?.has(payload.eventId)
    ));
    // An open socket, heartbeat or replay does not prove a usable session.
    // Reset the failure budget only after new, validated application output.
    if (AgentMessageType.Error !== payload.type && !isReplay) session.reconnectAttempt = 0;
    this.resetIdleTimeout(conversationId);
    if ((AgentMessageType.Question === payload.type || AgentMessageType.Result === payload.type ||
        AgentMessageType.Message === payload.type || AgentMessageType.Recommendations === payload.type) &&
        !isReplay) {
      const entry: HistoryEntry = { role: 'agent', content: payload.content };
      if (payload.eventId) {
        const received = this.unpersisted.get(conversationId) ?? new Map<string, HistoryEntry>();
        received.set(payload.eventId, entry);
        this.unpersisted.set(conversationId, received);
      }
      if (!this.rememberHistory(conversationId, entry)) return;
    }
    session.emitter.emit('message', payload);
  }

  private rememberHistory(
    conversationId: string,
    entry: AgentInitPayload['history'][number]
  ): boolean {
    const session = this.sessions.get(conversationId);
    if (!session?.lastInit) return true;
    const next = { ...session.lastInit, history: [...session.lastInit.history, entry] };
    try {
      // Reconnect must replay the latest answers/state without growing an
      // unbounded in-memory history or bypassing the normal payload limit.
      this.serializePayload(next);
      session.lastInit = next;
      return true;
    } catch (error) {
      this.failSession(conversationId, this.errorMessage(error));
      return false;
    }
  }

  private onSocketClose(
    conversationId: string,
    code: number
  ): void {
    const session = this.sessions.get(conversationId);
    if (!session) return;

    this.logger.log(
      `WS closed: conversationId="${conversationId}", code=${code}`
    );

    this.clearTimers(session);
    session.ws = null;

    if (session.closedByUser) return;

    if ([1003, 1007, 1008].includes(code)) {
      this.failSession(conversationId,
        'Сервис интервью отклонил соединение. Попробуйте позже.');
      return;
    }

    this.scheduleReconnect(conversationId);
  }

  private scheduleReconnect(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (!session || session.closedByUser || session.reconnectTimer) return;

    if (session.reconnectAttempt >= this.agentConfig.reconnectMaxAttempts) {
      this.logger.error(
        `WS reconnect attempts exhausted for conversationId="${conversationId}"`
      );
      this.failSession(
        conversationId,
        'Interviewer connection failed after all reconnect attempts'
      );
      return;
    }

    const attempt = session.reconnectAttempt + 1;
    session.reconnectAttempt = attempt;

    const delay = Math.min(
      this.agentConfig.reconnectInitialDelayMs * 2 ** (attempt - 1),
      this.agentConfig.reconnectMaxDelayMs
    );

    this.logger.log(
      `WS reconnect scheduled for conversationId="${conversationId}": attempt=${attempt}, delay=${delay}ms`
    );

    session.reconnectTimer = setTimeout(() => {
      if (this.sessions.get(conversationId) !== session || session.closedByUser) return;
      session.reconnectTimer = null;
      this.openSocket(conversationId);
    }, delay);
  }

  private startHeartbeat(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (!session || !session.ws) return;
    const ws = session.ws;

    this.clearHeartbeat(session);

    session.heartbeatInterval = setInterval(() => {
      const s = this.sessions.get(conversationId);
      if (s !== session || s.ws !== ws || ws.readyState !== WebSocket.OPEN) return;

      try {
        ws.ping();
      } catch (error) {
        this.logger.warn(
          `WS ping failed for conversationId="${conversationId}": ${this.errorMessage(error)}`
        );
        return;
      }

      s.heartbeatTimeout = setTimeout(() => {
        const s2 = this.sessions.get(conversationId);
        if (s2 !== session || s2.ws !== ws) return;
        this.logger.warn(
          `WS heartbeat timeout for conversationId="${conversationId}", terminating`
        );
        try {
          ws.terminate();
        } catch (error) {
          this.logger.warn(
            `WS terminate failed for conversationId="${conversationId}": ${this.errorMessage(error)}`
          );
        }
      }, this.agentConfig.heartbeatTimeoutMs);
    }, this.agentConfig.heartbeatIntervalMs);
  }

  private onPong(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (!session) return;
    if (session.heartbeatTimeout) {
      clearTimeout(session.heartbeatTimeout);
      session.heartbeatTimeout = null;
    }
  }

  private clearHeartbeat(session: SessionState): void {
    if (session.heartbeatInterval) {
      clearInterval(session.heartbeatInterval);
      session.heartbeatInterval = null;
    }
    if (session.heartbeatTimeout) {
      clearTimeout(session.heartbeatTimeout);
      session.heartbeatTimeout = null;
    }
  }

  private clearTimers(session: SessionState): void {
    this.clearHeartbeat(session);
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
      session.reconnectTimer = null;
    }
    if (session.idleTimeout) {
      clearTimeout(session.idleTimeout);
      session.idleTimeout = null;
    }
  }

  private rawSend(
    ws: WebSocket,
    serialized: string,
    conversationId: string
  ): void {
    try {
      ws.send(serialized, (error) => {
        if (!error) return;
        this.logger.warn(
          `WS async send failed for conversationId="${conversationId}": ${this.errorMessage(error)}`
        );
        try {
          ws.terminate();
        } catch {
          // close/reconnect path will handle the session if it is still active
        }
      });
    } catch (error) {
      this.logger.warn(
        `WS send failed for conversationId="${conversationId}": ${this.errorMessage(error)}`
      );
      throw error;
    }
  }

  private tryRawSend(
    ws: WebSocket,
    payload: AgentOutgoingPayload,
    conversationId: string
  ): boolean {
    try {
      const serialized = this.serializePayload(payload);
      this.assertTransportCapacity(ws, serialized, conversationId);
      this.rawSend(ws, serialized, conversationId);
      return true;
    } catch (error) {
      this.failSession(conversationId, this.errorMessage(error));
      return false;
    }
  }

  private serializePayload(payload: AgentOutgoingPayload): string {
    // Factory still calls a Test identifier benchmarkId. Translate only at
    // this transport boundary; Catalog storage, APIs and histories use testId.
    const factoryContent = <T extends object>(content: T) => {
      if ('kind' in content && 'recommendations' === content.kind && 'benchmarks' in content &&
          Array.isArray(content.benchmarks)) {
        return { ...content, benchmarks: content.benchmarks.map((item: { testId: string; explanation?: string }) => {
          const { testId, ...rest } = item;
          return { ...rest, benchmarkId: testId };
        }) };
      }
      if (!('testId' in content)) return content;
      const { testId, ...rest } = content;
      return { ...rest, benchmarkId: testId };
    };
    const wire = 'init' === payload.type
      ? { ...payload, history: payload.history.map((entry) => ({
        ...entry, content: factoryContent(entry.content),
      })) }
      : { ...payload, content: factoryContent(payload.content) };
    const serialized = JSON.stringify(wire);
    if (Buffer.byteLength(serialized) > this.agentConfig.maxPayloadBytes) {
      throw new PayloadTooLargeException(
        'Interviewer message exceeds the configured payload limit'
      );
    }
    return serialized;
  }

  private assertTransportCapacity(
    ws: WebSocket,
    serialized: string,
    conversationId: string
  ): void {
    const nextBufferedBytes = ws.bufferedAmount + Buffer.byteLength(serialized);
    if (nextBufferedBytes <= this.agentConfig.maxBufferedBytesPerSession) {
      return;
    }

    this.logger.warn(
      'Interviewer socket backpressure limit reached: ' +
      `conversationId="${conversationId}", bytes=${nextBufferedBytes}`
    );
    throw new ServiceUnavailableException(
      'Interviewer connection is congested; retry later'
    );
  }

  private resetIdleTimeout(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (!session) return;
    if (session.idleTimeout) clearTimeout(session.idleTimeout);
    session.idleTimeout = setTimeout(() => {
      if (this.sessions.get(conversationId) !== session) return;
      this.failSession(
        conversationId,
        'Interviewer session closed after inactivity timeout'
      );
    }, this.agentConfig.sessionIdleTimeoutMs);
  }

  private failSession(conversationId: string, message: string): void {
    const session = this.sessions.get(conversationId);
    if (!session || session.closedByUser) return;
    session.emitter.emit('message', {
      type: AgentMessageType.Error,
      isFinal: true,
      content: { message },
    } satisfies AgentMessagePayload);
    if (this.sessions.get(conversationId) === session) this.close(conversationId);
  }

  private parseAgentMessagePayload(value: unknown): AgentMessagePayload | null {
    if (!value || typeof value !== 'object') return null;
    const obj = value as { type?: unknown; content?: unknown; isFinal?: unknown; eventId?: unknown };
    if (obj.eventId !== undefined && (typeof obj.eventId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(obj.eventId))) return null;
    if (AgentMessageType.Error === obj.type) {
      const content = obj.content as { message?: unknown } | undefined;
      return true === obj.isFinal && 'string' === typeof content?.message
        ? value as AgentMessagePayload
        : null;
    }
    if (typeof obj.isFinal !== 'boolean') return null;
    if (!obj.content || typeof obj.content !== 'object') return null;
    const content = obj.content as {
      kind?: unknown;
      label?: unknown;
      options?: unknown;
      status?: unknown;
      hypotheses?: unknown;
      testId?: unknown;
      benchmarkId?: unknown;
      questionKey?: unknown;
      interviewState?: unknown;
      generationJobId?: unknown;
      benchmarks?: unknown;
    };
    if (AgentMessageType.Message === obj.type) {
      return !obj.isFinal && 'text' === content.kind && 'string' === typeof content.label && content.label.trim()
        ? value as AgentMessagePayload : null;
    }
    if (AgentMessageType.Recommendations === obj.type) {
      if (obj.isFinal || content.kind !== 'recommendations' || typeof content.label !== 'string' ||
          !content.label.trim() || !Array.isArray(content.benchmarks) || content.benchmarks.length > 20) return null;
      const benchmarks: { testId: string; explanation?: string }[] = [];
      for (const item of content.benchmarks) {
        if (!item || typeof item !== 'object') return null;
        const candidate = item as { testId?: unknown; benchmarkId?: unknown; explanation?: unknown };
        const testId = candidate.testId ?? candidate.benchmarkId;
        if (typeof testId !== 'string' || !testId.trim() ||
            (candidate.explanation !== undefined && typeof candidate.explanation !== 'string')) return null;
        benchmarks.push({ testId, ...(candidate.explanation !== undefined ? { explanation: candidate.explanation } : {}) });
      }
      return { type: AgentMessageType.Recommendations, isFinal: false,
        ...(obj.eventId ? { eventId: obj.eventId } : {}),
        content: { kind: 'recommendations', label: content.label, benchmarks } };
    }
    if (AgentMessageType.Question === obj.type) {
      const optionsAreValid =
        undefined === content.options ||
        null === content.options ||
        (Array.isArray(content.options) &&
          content.options.every(
            (option) =>
              option &&
              'object' === typeof option &&
              'string' === typeof (option as { id?: unknown }).id &&
              'string' === typeof (option as { label?: unknown }).label
          ));
      return (
        'question' === content.kind &&
        'string' === typeof content.label &&
        (undefined === content.questionKey || ('string' === typeof content.questionKey &&
          content.questionKey.trim().length > 0 && content.questionKey.length <= 255)) &&
        (undefined === content.interviewState || (
          null !== content.interviewState && 'object' === typeof content.interviewState &&
          !Array.isArray(content.interviewState) &&
          Object.values(content.interviewState).every((item) => 'string' === typeof item)
        )) &&
        optionsAreValid
      ) ? value as AgentMessagePayload : null;
    }
    if (AgentMessageType.Result === obj.type) {
      if (
        (undefined !== content.testId &&
          'string' !== typeof content.testId) ||
        (undefined !== content.benchmarkId &&
          'string' !== typeof content.benchmarkId)
      ) {
        return null;
      }
      const testId = 'string' === typeof content.testId
        ? content.testId
        : content.benchmarkId;
      if (
        'result' !== content.kind ||
        'string' !== typeof content.label ||
        !['done', 'finished', 'generating'].includes(String(content.status)) ||
        ('generating' === content.status && (obj.isFinal ||
          'string' !== typeof content.generationJobId ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(content.generationJobId))) ||
        (undefined !== content.generationJobId && 'string' !== typeof content.generationJobId) ||
        (undefined !== testId && 'string' !== typeof testId)
      ) {
        return null;
      }

      return {
        type: AgentMessageType.Result,
        isFinal: obj.isFinal,
        ...(obj.eventId ? { eventId: obj.eventId } : {}),
        content: {
          kind: 'result',
          label: content.label,
          ...(testId ? { testId } : {}),
          ...(content.generationJobId ? { generationJobId: content.generationJobId } : {}),
          status: content.status as 'done' | 'finished' | 'generating',
        },
      };
    }
    if (AgentMessageType.Hypotheses === obj.type) {
      if (
        (undefined !== content.testId &&
          'string' !== typeof content.testId) ||
        (undefined !== content.benchmarkId &&
          'string' !== typeof content.benchmarkId)
      ) {
        return null;
      }
      const testId = 'string' === typeof content.testId
        ? content.testId
        : content.benchmarkId;
      if (
        'hypotheses' !== content.kind ||
        !Array.isArray(content.hypotheses) ||
        !content.hypotheses.every((item) => 'string' === typeof item) ||
        'string' !== typeof testId
      ) {
        return null;
      }

      return {
        type: AgentMessageType.Hypotheses,
        isFinal: obj.isFinal,
        ...(obj.eventId ? { eventId: obj.eventId } : {}),
        content: {
          kind: 'hypotheses',
          hypotheses: content.hypotheses,
          testId,
        },
      };
    }
    return null;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
