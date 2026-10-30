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
  AwaitRevisionConfirmation: 'await_revision_confirmation',
  AwaitRevision: 'await_revision',
  Producing: 'producing',
  Closed: 'closed',
} as const;

type SessionState = Pick<SessionStateAgentWsService, 'emitter'> & {
  step: typeof SessionStep[keyof typeof SessionStep];
  revisionSourceText?: string;
  productionTimer?: ReturnType<typeof setTimeout>;
  productionExamples?: Array<{ input: string; expectedOutput: string }>;
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

    if (session.productionTimer) clearTimeout(session.productionTimer);
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
    if (history.some((entry) => 'agent' === entry.role && entry.content.label.startsWith('MOCK_SET_READY:'))) {
      session.step = SessionStep.Closed;
      return;
    }
    const lastUserMessage = [...history].reverse().find((entry) => 'user' === entry.role && entry.content.kind === MessageKind.text);
    if ('user' === lastUserMessage?.role && lastUserMessage.content.kind === MessageKind.text &&
      lastUserMessage.content.label.startsWith('Масштабировать выбранные примеры:')) {
      session.step = SessionStep.Producing;
      session.productionExamples = this.parseSelectedExamples(lastUserMessage.content.label);
      const initialRequest = history.find((entry) => 'user' === entry.role && entry.content.kind === MessageKind.text && entry.content.label.includes('ID исходного бенчмарка:'));
      if ('user' === initialRequest?.role && initialRequest.content.kind === MessageKind.text) {
        session.revisionSourceText = initialRequest.content.label;
      }
      this.finishMockProduction(conversationId, session);
      return;
    }
    const revisionRequest = history.findLast((entry) =>
      'user' === entry.role && entry.content.kind === MessageKind.text &&
      entry.content.label.includes('ID исходного бенчмарка:') &&
      entry.content.label.includes('Что изменить:')
    );
    if ('user' === revisionRequest?.role && revisionRequest.content.kind === MessageKind.text) {
      session.step = history.some((entry) => 'agent' === entry.role && entry.content.label.startsWith('MOCK_GENERATED_EXAMPLES:'))
        ? SessionStep.AwaitRevision : SessionStep.AwaitRevisionConfirmation;
      session.revisionSourceText = revisionRequest.content.label;
      const last = history.at(-1);
      if (session.step === SessionStep.AwaitRevision) return;
      if ('agent' === last?.role && last.content.label.includes('Требования подтверждены.')) {
        session.step = SessionStep.Closed;
        return;
      }
      if (last?.role !== 'agent' || !last.content.label.includes('Всё готово к подтверждению')) {
        this.emit(conversationId, this.revisionSummary(revisionRequest.content.label));
      }
      return;
    }

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

    if (data.content.kind === MessageKind.text &&
      data.content.label.includes('ID исходного бенчмарка:') &&
      data.content.label.includes('Что изменить:')) {
      session.step = SessionStep.AwaitRevisionConfirmation;
      session.revisionSourceText = data.content.label;
      this.emit(conversationId, this.revisionSummary(data.content.label));
      return;
    }

    if (session.step === SessionStep.AwaitRevisionConfirmation && data.content.kind === MessageKind.text) {
      if (/требования подтверждаю|начни генерацию/i.test(data.content.label)) {
        session.step = SessionStep.AwaitRevision;
        this.emit(conversationId, this.revisionExamples(session.revisionSourceText ?? ''));
      } else {
        this.emit(conversationId, this.revisionSummary(session.revisionSourceText ?? data.content.label, data.content.label));
      }
      return;
    }

    if (session.step === SessionStep.AwaitRevision && data.content.kind === MessageKind.text) {
      if (data.content.label.startsWith('Масштабировать выбранные примеры:')) {
        session.step = SessionStep.Producing;
        session.productionExamples = this.parseSelectedExamples(data.content.label);
        this.finishMockProduction(conversationId, session);
      } else {
        this.emit(conversationId, this.revisionExamples(session.revisionSourceText ?? '', data.content.label));
      }
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

  private revisionSummary(text: string, correction?: string): AgentMessagePayload {
    const field = (pattern: RegExp) => text.match(pattern)?.[1]?.trim() || 'Не указано';
    const mode = /русскоязычной адаптации/i.test(text) ? 'Русифицировать' : 'Улучшить';
    const name = field(/бенчмарка «([^»]+)»/);
    const change = [field(/Что изменить: ([\s\S]*?)(?:\n\nТест: |\n\nПример \d+ из |$)/), correction].filter(Boolean).join('; ');
    const rows = [
      'Всё готово к подтверждению',
      'Проверьте требования:',
      `Способ создания: ${mode}`,
      `Исходный набор: ${name}`,
      `Задача: ${field(/Описание: ([^\n]+)/)}`,
      `Название: ${name}`,
      `Домен: ${field(/Домены: ([^\n]+)/)}`,
      `Язык: ${'Русифицировать' === mode ? 'Русский' : field(/Язык: ([^\n]+)/)}`,
      `Сложность: ${field(/Сложность: ([^\n]+)/)}`,
      `Метрика: ${field(/Метрики: ([^\n]+)/)}`,
      `Формат ответа: ${field(/Формат ответа: ([^\n]+)/)}`,
      `Что изменить: ${change}`,
    ];
    return {
      type: AgentMessageType.Question,
      isFinal: true,
      content: { kind: 'question', label: rows.join('\n'), options: null },
    };
  }

  private revisionExamples(source: string, revision?: string): AgentMessagePayload {
    const samples = [...source.matchAll(/Пример \d+ из «[^»]+»: ([\s\S]*?)(?=\n\nПример \d+ из |$)/g)]
      .slice(0, 3)
      .map((match) => {
        const [input, expectedOutput] = match[1].split('\nЭталон: ');
        return { input: input.trim(), expectedOutput: expectedOutput?.trim() || 'Уточните эталонный ответ.' };
      });
    const change = source.match(/Что изменить: ([^\n]+)/)?.[1]?.trim() || 'проверьте указанную задачу';
    while (samples.length < 3) {
      const index = samples.length + 1;
      samples.push({
        input: `Пример ${index}: ${change}`,
        expectedOutput: 'Укажите проверяемый эталонный ответ.',
      });
    }
    if (revision) samples[0].input = `${samples[0].input}\nУточнение: ${revision}`;
    return {
      type: AgentMessageType.Message,
      isFinal: false,
      content: { kind: 'text', label: `MOCK_GENERATED_EXAMPLES:${JSON.stringify(samples)}` },
    };
  }

  private finishMockProduction(conversationId: string, session: SessionState): void {
    if (session.productionTimer) return;
    session.productionTimer = setTimeout(() => {
      session.productionTimer = undefined;
      if (this.sessions.get(conversationId) !== session || session.step !== SessionStep.Producing) return;
      session.step = SessionStep.Closed;
      const source = session.revisionSourceText ?? '';
      const name = source.match(/бенчмарка «([^»]+)»/)?.[1] || 'Новый набор';
      const examples = session.productionExamples ?? [];
      this.emit(conversationId, {
        type: AgentMessageType.Result,
        isFinal: true,
        content: { kind: 'result', label: `MOCK_SET_READY:${JSON.stringify({ name, examples, sourceId: source.match(/ID исходного бенчмарка: ([^\n]+)/)?.[1] ?? null })}`, status: 'done' },
      });
    }, 15000);
  }

  private parseSelectedExamples(label: string): Array<{ input: string; expectedOutput: string }> {
    try {
      const rows: unknown = JSON.parse(label.slice('Масштабировать выбранные примеры:'.length).trim());
      if (!Array.isArray(rows)) return [];
      return rows.filter((row): row is { input: string; expectedOutput: string } =>
        'object' === typeof row && row !== null && 'string' === typeof row.input && 'string' === typeof row.expectedOutput
      ).map(({ input, expectedOutput }) => ({ input, expectedOutput }));
    } catch {
      return [];
    }
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
        resultKey: 'mock_draft_ready',
        status: 'done',
      },
    };
  }
}
