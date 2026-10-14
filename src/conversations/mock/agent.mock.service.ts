import { EventEmitter } from 'events';
import { Injectable, Logger } from '@nestjs/common';
import { AgentMessageType } from '@/common/enums/agentMessageType.enum';
import { MessageKind } from '@/generated/prisma/enums';
import { IAgentService } from '../agent/agent.service.interface';
import { SessionState as SessionStateAgentWsService } from '../agent/agent.ws.service';
import {
  AgentClientMessagePayload,
  AgentMessagePayload,
  AgentOutgoingPayload,
  HistoryEntry,
} from '../types';

const SessionStep = {
  AwaitInit: 'await_init',
  AwaitInitialText: 'await_initial_text',
  AwaitDomain: 'await_domain',
  AwaitDifficulty: 'await_difficulty',
  AwaitDatasetSize: 'await_dataset_size',
  Closed: 'closed',
} as const;

type SessionState = Pick<SessionStateAgentWsService, 'emitter'> & {
  step: typeof SessionStep[keyof typeof SessionStep];
};

/**
 * Мок внешнего WS-сервиса.
 * Интерфейс приближен к нативному `ws` (connect / send / onMessage / close),
 * чтобы в проде заменить одной строкой на:
 *   const ws = new WebSocket(process.env.THIRD_PARTY_WS_URL, { headers: {...} })
 */
@Injectable()
export class AgentMockService implements IAgentService {
  private readonly logger = new Logger(AgentMockService.name);
  private readonly sessions = new Map<string, SessionState>();

  connect(conversationId: string): void {
    if (this.sessions.has(conversationId)) {
      this.logger.warn(
        `Mock session already exists for conversationId="${conversationId}"`
      );
      return;
    }

    this.sessions.set(conversationId, {
      emitter: new EventEmitter(),
      step: SessionStep.AwaitInit,
    });

    this.logger.log(`Mock connected: conversationId="${conversationId}"`);
  }

  onMessage(
    conversationId: string,
    callback: (data: AgentMessagePayload) => void
  ): void {
    const session = this.sessions.get(conversationId);
    if (!session) {
      this.logger.warn(
        `Cannot subscribe — no mock session for conversationId="${conversationId}"`
      );
      return;
    }
    session.emitter.removeAllListeners('message');
    session.emitter.on('message', callback);
  }

  send(conversationId: string, data: AgentOutgoingPayload): void {
    const session = this.sessions.get(conversationId);
    if (!session || SessionStep.Closed === session.step) {
      this.logger.warn(
        `Cannot send — no active mock session for conversationId="${conversationId}"`
      );
      return;
    }
    setImmediate(() => this.handle(conversationId, data));
  }

  close(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (!session) return;

    session.emitter.removeAllListeners();
    session.step = SessionStep.Closed;
    this.sessions.delete(conversationId);

    this.logger.log(`Mock closed: conversationId="${conversationId}"`);
  }

  private handle(conversationId: string, data: AgentOutgoingPayload): void {
    const session = this.sessions.get(conversationId);
    if (!session || SessionStep.Closed === session.step) return;

    try {
      if ('init' === data.type) {
        this.handleInit(conversationId, data.history, session);
        return;
      }

      if ('message' === data.type) {
        this.handleClientMessage(conversationId, data, session);
        return;
      }
    } catch (error) {
      this.logger.error(
        `Mock handler failure for conversationId="${conversationId}": ${(error as Error).message}`
      );
    }
  }

  private handleInit(
    conversationId: string,
    history: HistoryEntry[],
    session: SessionState
  ): void {
    const userAnswers = history.filter(
      (entry) =>
        'user' === entry.role &&
        MessageKind.recommendation_rejected !== entry.content.kind &&
        MessageKind.recommendation_selected !== entry.content.kind
    );
    const answerCount = userAnswers.length;

    switch (answerCount) {
      case 0:
        session.step = SessionStep.AwaitInitialText;
        this.emit(conversationId, this.initialQuestion());
        break;

      case 1:
        session.step = SessionStep.AwaitDomain;
        this.emit(conversationId, this.domainQuestion());
        break;

      case 2:
        session.step = SessionStep.AwaitDifficulty;
        this.emit(conversationId, this.difficultyQuestion());
        break;

      case 3:
        session.step = SessionStep.AwaitDatasetSize;
        this.emit(conversationId, this.datasetSizeQuestion());
        break;

      default:
      // Четыре ответа полностью заполняют локальный mock-wizard.
        session.step = SessionStep.Closed;
        this.emit(conversationId, this.finalNarrowed());
        break;
    }
  }

  private handleClientMessage(
    conversationId: string,
    data: AgentClientMessagePayload,
    session: SessionState
  ): void {
    if (
      MessageKind.recommendation_selected === data.content.kind ||
      MessageKind.recommendation_rejected === data.content.kind
    ) {
      return;
    }

    switch (session.step) {
      case SessionStep.AwaitInitialText:
        session.step = SessionStep.AwaitDomain;
        this.emit(conversationId, this.domainQuestion());
        return;

      case SessionStep.AwaitDomain:
        session.step = SessionStep.AwaitDifficulty;
        this.emit(conversationId, this.difficultyQuestion());
        return;

      case SessionStep.AwaitDifficulty:
        session.step = SessionStep.AwaitDatasetSize;
        this.emit(conversationId, this.datasetSizeQuestion());
        return;

      case SessionStep.AwaitDatasetSize:
        session.step = SessionStep.Closed;
        this.emit(conversationId, this.finalNarrowed());
        return;

      default:
        this.logger.warn(
          `Unexpected message in step="${session.step}" for conversationId="${conversationId}"`
        );
    }
  }

  private emit(conversationId: string, payload: AgentMessagePayload): void {
    const session = this.sessions.get(conversationId);
    if (!session) return;
    session.emitter.emit('message', payload);
  }

  private initialQuestion(): AgentMessagePayload {
    return {
      type: AgentMessageType.Question,
      isFinal: false,
      content: {
        kind: 'question',
        label: 'Опишите задачу для нового бенчмарка',
        options: null,
      },
    };
  }

  private domainQuestion(): AgentMessagePayload {
    return {
      type: AgentMessageType.Question,
      isFinal: false,
      content: {
        kind: 'question',
        label: 'Какой домен вас интересует?',
        options: [
          { id: '1', label: 'NLP' },
          { id: '2', label: 'CV' },
          { id: '3', label: 'Multimodal' },
        ],
      },
    };
  }

  private difficultyQuestion(): AgentMessagePayload {
    return {
      type: AgentMessageType.Question,
      isFinal: false,
      content: {
        kind: 'question',
        label: 'Какой уровень сложности?',
        options: [
          { id: '1', label: 'Базовый' },
          { id: '2', label: 'Средний' },
          { id: '3', label: 'Продвинутый' },
        ],
      },
    };
  }

  private datasetSizeQuestion(): AgentMessagePayload {
    return {
      type: AgentMessageType.Question,
      isFinal: false,
      content: {
        kind: 'question',
        label: 'Какой размер датасета предпочтителен?',
        options: [
          { id: '1', label: 'Маленький (< 1000)' },
          { id: '2', label: 'Средний (1000-10000)' },
          { id: '3', label: 'Большой (> 10000)' },
        ],
      },
    };
  }

  private finalNarrowed(): AgentMessagePayload {
    return {
      type: AgentMessageType.Result,
      isFinal: true,
      content: {
        kind: 'result',
        label: 'Черновик нового бенчмарка сформирован (mock)',
        status: 'done',
      },
    };
  }
}
