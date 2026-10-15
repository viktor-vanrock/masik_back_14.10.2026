import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  PayloadTooLargeException,
} from '@nestjs/common';
import { PaginationDto } from '@/common/dtos/paginationDto.dto';
import { AgentMessageType } from '@/common/enums/agentMessageType.enum';
import { InfiniteDataResponseType } from '@/common/types/infiniteDataResponse.type';
import { RequestUser } from '@/common/types/request.type';
import {
  Conversation,
  ConversationIntent,
  ConversationStatus,
  Message,
  MessageKind,
  MessageRole,
  RecommendationRequest,
  Prisma,
} from '@/generated/prisma/client';
import { HypothesesService } from '@/hypotheses/hypotheses.service';
import {
  presentRecommendationResultPayload,
  presentTestTargetObject,
} from '@/recommendations/recommendation-contract.presenter';
import { RecommendationRequestsService } from '@/recommendations/recommendation-requests.service';
import { RecommendationsService } from '@/recommendations/recommendations.service';
import { IAgentService } from './agent/agent.service.interface';
import { IConversationsRepository } from './repository/conversations.repository.interface';
import {
  AgentInitPayload,
  AgentMessageHandler,
  AgentMessageOption,
  AgentMessagePayload,
  AgentQuestionContent,
  AgentResultContent,
  ConversationWithMessages,
  HistoryEntry,
  HypothesesGeneratedHandler,
  RequestRecommendationsParams,
  SendUserMessageParams,
  StartBenchmarkCreationParams,
  StartChatParams,
  UserMessageContent,
} from './types';

export type { AgentMessageHandler } from './types';

/**
 * Бизнес логика чата.
 * - persist в БД
 * - управление сессиями к внешнему сервису (мок)
 * - построение init-payload по истории
 */
@Injectable()
export class ConversationsService implements OnModuleDestroy {
  private readonly logger = new Logger(ConversationsService.name);

  /** активные сессии агента: conversationId -> IAgentService */
  private readonly activeSessions = new Map<string, IAgentService>();
  /**
   * Один Interviewer может прислать кадры подряд быстрее, чем PostgreSQL
   * сохранит предыдущий. Цепочка сохраняет порядок внутри conversation.
   */
  private readonly messageProcessing = new Map<string, Promise<void>>();
  /** Serializes duplicate start/reject commands for one conversation. */
  private readonly benchmarkCreationProcessing = new Map<
    string,
    Promise<void>
  >();

  constructor(
    @Inject(IConversationsRepository)
    private readonly repository: IConversationsRepository,
    @Inject(IAgentService)
    private readonly agent: IAgentService,
    private readonly recommendationRequestsService: RecommendationRequestsService,
    private readonly hypothesesService: HypothesesService,
    private readonly recommendationsService: RecommendationsService
  ) {}

  async requestRecommendations(
    params: RequestRecommendationsParams
  ): Promise<RecommendationRequest> {
    const conversation = await this.repository.findById(params.conversationId, params.userId);

    if (!conversation || conversation.userId !== params.userId) {
      throw new NotFoundException(
        `Conversation "${params.conversationId}" was not found`
      );
    }

    if (ConversationStatus.active !== conversation.status) {
      throw new BadRequestException(
        `Conversation "${params.conversationId}" ` +
        'cannot request recommendations in ' +
        `"${conversation.status}" status`
      );
    }

    if (ConversationIntent.create_new === conversation.intent) {
      throw new BadRequestException(
        `Conversation "${params.conversationId}" ` +
        'has already started benchmark creation'
      );
    }

    if (ConversationIntent.find_existing !== conversation.intent) {
      /**
       * Фиксируем назначение workflow.
       *
     * Если обращение к моделям затем завершится ошибкой,
       * пользователь сможет безопасно повторить поиск.
       */
      await this.repository.updateIntent(
        params.conversationId,
        ConversationIntent.find_existing
      );
    }

    /**
     * topK не принимаем от браузера.
     * RecommendationRequestsService применит серверный default = 1.
     *
     * Сначала фиксируем pending-запрос, затем gateway подтверждает его браузеру.
     */
    return this.recommendationRequestsService.createPending({
      conversationId: params.conversationId,
      query: params.query,
    });
  }

  executeRecommendationRequest(request: RecommendationRequest) {
    return this.recommendationRequestsService.execute(request);
  }

  async findAll(
    queryParams: PaginationDto,
    user: RequestUser
  ): Promise<InfiniteDataResponseType<Conversation>> {
    this.logger.debug('Fetching all conversations');

    return this.repository.findAll(queryParams, user.id);
  }

  async findByIdWithMessages(
    id: string,
    user: RequestUser
  ): Promise<ConversationWithMessages> {
    const conversation = await this.repository.findByIdWithMessages(id, user.id);
    if (!conversation) {
      throw new NotFoundException(`Conversation "${id}" was not found`);
    }
    return {
      ...conversation,
      messages: conversation.messages.map((message) => ({
        ...message,
        options: presentTestTargetObject(message.options),
      })),
      recommendationRequests: conversation.recommendationRequests.map(
        (request) => ({
          ...request,
          resultPayload: presentRecommendationResultPayload(
            request.resultPayload
          ),
        })
      ),
    };
  }

  async findById(id: string, user: RequestUser): Promise<Conversation> {
    const conversation = await this.repository.findById(id, user.id);
    if (!conversation) {
      throw new NotFoundException(`Conversation "${id}" was not found`);
    }
    return conversation;
  }

  async updateConversation(
    id: string,
    user: RequestUser,
    data: { title?: string; isArchived?: boolean },
  ): Promise<Conversation> {
    const conversation = await this.repository.findById(id, user.id);
    if (!conversation || conversation.userId !== user.id) {
      throw new NotFoundException(`Conversation "${id}" was not found`);
    }
    return this.repository.update(id, {
      ...(data.title !== undefined ? { title: data.title.slice(0, 255) } : {}),
      ...(data.isArchived !== undefined ? { isArchived: data.isArchived } : {}),
    });
  }

  async getAgentContext(id: string) {
    const conversation = await this.repository.getAgentContext(id);
    if (!conversation) throw new NotFoundException(`Conversation "${id}" was not found`);
    return { context: conversation.agentContext ?? null };
  }

  async updateAgentContext(id: string, context: Prisma.InputJsonObject) {
    await this.getAgentContext(id);
    if (Buffer.byteLength(JSON.stringify(context), 'utf8') > 1024 * 1024) {
      throw new PayloadTooLargeException('Agent context exceeds 1 MiB');
    }
    const conversation = await this.repository.updateAgentContext(id, context);
    return { context: conversation.agentContext };
  }

  /**
   * Interviewer ведёт разговор с первого сообщения, включая поиск и создание.
   */
  async startChat(params: StartChatParams): Promise<string> {
    let conversation: Conversation | null = null;

    if (params.conversationId) {
      conversation = await this.repository.findById(params.conversationId, params.userId);
      if (!conversation) {
        throw new NotFoundException(
          `Conversation "${params.conversationId}" was not found`
        );
      }
      if (conversation.userId !== params.userId) {
        throw new NotFoundException(
          `Conversation "${params.conversationId}" was not found`
        );
      }
    } else {
      conversation = await this.repository.createConversation(params.userId);
    }

    const conversationId = conversation.id;

    if (conversation.status === ConversationStatus.abandoned) {
      return conversationId;
    }

    const wasActive = this.activeSessions.has(conversationId);
    this.openSession(conversationId, params.onAgent, params.onHypotheses);
    if (wasActive) return conversationId;

    const history = await this.buildHistory(conversationId, params.userId);
    const initPayload: AgentInitPayload = {
      type: 'init',
      conversationId,
      intent: conversation.intent,
      history,
    };

    this.agent.send(conversationId, initPayload);

    return conversationId;
  }

  /**
   * Обрабатывает входящее сообщение юзера.
   * - валидирует существование чата и активной сессии
   * - сохраняет сообщение в БД
   */
  async sendUserMessage(params: SendUserMessageParams): Promise<void> {
    const conversation = await this.repository.findById(params.conversationId, params.userId);
    if (!conversation || conversation.userId !== params.userId) {
      throw new NotFoundException(
        `Conversation "${params.conversationId}" was not found`
      );
    }

    if (conversation.status === ConversationStatus.abandoned) {
      throw new BadRequestException(
        `Conversation "${params.conversationId}" cannot accept messages in "${conversation.status}" status`
      );
    }

    if (conversation.status === ConversationStatus.awaiting_choice) {
      await this.repository.updateStatus(params.conversationId, ConversationStatus.active);
    }

    if (!this.activeSessions.has(params.conversationId)) {
      this.openSession(params.conversationId, params.onAgent, params.onHypotheses);

      const history = await this.buildHistory(params.conversationId, params.userId);
      this.agent.send(params.conversationId, {
        type: 'init',
        conversationId: params.conversationId,
        intent: conversation.intent,
        history,
      });
    }

    let content: UserMessageContent;
    let persistedKind: MessageKind;
    let persistedContent: string;
    let persistedOptionId: string | null = null;

    switch (params.kind) {
      case MessageKind.option: {
        content = {
          kind: MessageKind.option,
          id: params.value,
          label: params.label ?? params.value,
        };
        persistedKind = MessageKind.option;
        persistedContent = content.label;
        persistedOptionId = params.value;
        break;
      }
      case MessageKind.recommendation_selected: {
        content = {
          kind: MessageKind.recommendation_selected,
          testId: params.value,
        };
        persistedKind = MessageKind.recommendation_selected;
        persistedContent = params.value;
        break;
      }
      case MessageKind.recommendation_rejected: {
        content = {
          kind: MessageKind.recommendation_rejected,
          testId: params.value,
        };
        persistedKind = MessageKind.recommendation_rejected;
        persistedContent = params.value;
        break;
      }
      case MessageKind.text:
      default: {
        content = { kind: MessageKind.text, label: params.value };
        persistedKind = MessageKind.text;
        persistedContent = params.value;
        break;
      }
    }

    await this.repository.createMessage({
      conversationId: params.conversationId,
      role: MessageRole.user,
      kind: persistedKind,
      content: persistedContent,
      optionId: persistedOptionId,
      options: null,
    });

    this.agent.send(params.conversationId, {
      type: 'message',
      content,
    });
    if (params.kind === MessageKind.recommendation_rejected) {
      await this.repository.updateIntent(params.conversationId, ConversationIntent.create_new);
    }
  }

  /**
   * Перегенерация гипотез по существующему чату.
   * Шлём агенту всю историю как init — он ответит payload'ом с type: 'hypotheses',
   * handleAgentMessage сам сохранит новую попытку (attemptNumber инкрементируется).
   */
  async regenerateHypotheses(
    params: Pick<
      SendUserMessageParams,
      'userId' | 'conversationId' | 'onAgent' | 'onHypotheses'
    >
  ): Promise<void> {
    const conversation = await this.repository.findById(params.conversationId, params.userId);
    if (!conversation || conversation.userId !== params.userId) {
      throw new NotFoundException(
        `Conversation "${params.conversationId}" was not found`
      );
    }

    // если сессии нет (рестарт сервера / новый сокет) — поднимаем её
    if (!this.activeSessions.has(params.conversationId)) {
      this.openSession(params.conversationId, params.onAgent, params.onHypotheses);
    } else {
      // пере-подписываем актуальный сокет на ту же сессию
      this.openSession(params.conversationId, params.onAgent, params.onHypotheses);
    }

    const history = await this.buildHistory(params.conversationId, params.userId);

    const initPayload: AgentInitPayload = {
      type: 'init',
      conversationId: params.conversationId,
      intent: conversation.intent,
      history,
    };

    this.logger.log(
      `Regenerating hypotheses: conversationId="${params.conversationId}", historySize=${history.length}`
    );

    this.agent.send(params.conversationId, initPayload);
  }

  async acceptRecommendation(
    conversationId: string,
    testId: string
  ): Promise<void> {
    await this.repository.completeWithRecommendation(
      conversationId,
      testId
    );
    this.closeSession(conversationId);
  }

  async startBenchmarkCreation(
    params: StartBenchmarkCreationParams
  ): Promise<void> {
    const previous = this.benchmarkCreationProcessing.get(
      params.conversationId
    ) ?? Promise.resolve();
    const current = previous.then(() =>
      this.startBenchmarkCreationOnce(params)
    );
    this.benchmarkCreationProcessing.set(params.conversationId, current);

    try {
      await current;
    } finally {
      if (
        this.benchmarkCreationProcessing.get(params.conversationId) === current
      ) {
        this.benchmarkCreationProcessing.delete(params.conversationId);
      }
    }
  }

  private async startBenchmarkCreationOnce(
    params: StartBenchmarkCreationParams
  ): Promise<void> {
    const conversation = await this.repository.findById(params.conversationId, params.userId);
    if (!conversation || conversation.userId !== params.userId) {
      throw new NotFoundException(
        `Conversation "${params.conversationId}" was not found`
      );
    }
    if (ConversationStatus.completed === conversation.status) {
      throw new BadRequestException(
        `Conversation "${params.conversationId}" is already completed`
      );
    }
    if (ConversationStatus.generating === conversation.status) return;

    let transitioned = false;
    if (ConversationIntent.create_new !== conversation.intent) {
      transitioned = await this.repository.beginBenchmarkCreation(
        params.conversationId,
        conversation.intent,
        params.rejectedTestId
      );
      if (!transitioned) {
        const current = await this.repository.findById(params.conversationId, params.userId);
        if (!current || ConversationStatus.completed === current.status) {
          throw new BadRequestException(
            `Conversation "${params.conversationId}" is already completed`
          );
        }
      }
    }

    const wasActive = this.activeSessions.has(params.conversationId);
    this.openSession(
      params.conversationId,
      params.onAgent,
      params.onHypotheses
    );
    if (wasActive && ConversationIntent.create_new === conversation.intent) {
      return;
    }

    const history = await this.buildHistory(params.conversationId, params.userId);
    this.agent.send(params.conversationId, {
      type: 'init',
      conversationId: params.conversationId,
      intent: ConversationIntent.create_new,
      history,
    });
    if (transitioned) {
      if (params.rejectedTestId) {
        // beginBenchmarkCreation atomically persisted this rejection already.
        this.agent.send(params.conversationId, { type: 'message',
          content: { kind: 'recommendation_rejected', testId: params.rejectedTestId } });
      } else {
        await this.sendUserMessage({ ...params, kind: 'text', value: 'Хочу создать свой бенчмарк.' });
      }
    }
  }

  /** Корректно закрыть сессию (по disconnect или isFinal). */
  closeSession(conversationId: string): void {
    if (!this.activeSessions.has(conversationId)) return;
    this.agent.close(conversationId);
    this.activeSessions.delete(conversationId);
    this.logger.log(`Session closed: conversationId="${conversationId}"`);
  }

  async onModuleDestroy(): Promise<void> {
    for (const conversationId of Array.from(this.activeSessions.keys())) {
      this.closeSession(conversationId);
    }
    await Promise.allSettled(this.messageProcessing.values());
  }

  // ----------------------------------------------------------------------
  //  internals
  // ----------------------------------------------------------------------

  private openSession(
    conversationId: string,
    onAgent: AgentMessageHandler,
    onHypotheses?: HypothesesGeneratedHandler
  ): void {
    const subscribe = (payload: AgentMessagePayload): void => {
      const previous = this.messageProcessing.get(conversationId) ??
        Promise.resolve();
      const current = previous.catch(() => undefined).then(() =>
        this.handleAgentMessage(
          conversationId,
          payload,
          onAgent,
          onHypotheses
        )
      );
      this.messageProcessing.set(conversationId, current);
      void current.finally(() => {
        if (this.messageProcessing.get(conversationId) === current) {
          this.messageProcessing.delete(conversationId);
        }
      }).catch((error: unknown) => {
        this.logger.error(`Agent output processing failed for conversationId="${conversationId}": ${String(error)}`);
      });
    };

    if (this.activeSessions.has(conversationId)) {
      // переподписка нового сокета на ту же сессию
      this.agent.onMessage(conversationId, subscribe);
      return;
    }

    this.agent.connect(conversationId);
    this.agent.onMessage(conversationId, subscribe);
    this.activeSessions.set(conversationId, this.agent);
  }

  private async handleAgentMessage(
    conversationId: string,
    payload: AgentMessagePayload,
    onAgent: AgentMessageHandler,
    onHypotheses?: HypothesesGeneratedHandler
  ): Promise<void> {
    try {
      // Ignore stale frames from a transport that has already been closed.
      if (!this.activeSessions.has(conversationId)) return;

      if (AgentMessageType.Error === payload.type) {
        onAgent({ ...payload, conversationId });
        this.closeSession(conversationId);
        return;
      }

      this.assertAgentPayload(payload);

      if (AgentMessageType.Message === payload.type) {
        const saved = await this.repository.createMessage({
          id: payload.eventId, conversationId, role: MessageRole.agent,
          kind: MessageKind.text, content: payload.content.label, options: null,
        });
        if (payload.eventId) this.agent.acknowledgeMessage?.(conversationId, payload.eventId);
        onAgent({ ...payload, id: saved.id, conversationId });
      } else if (AgentMessageType.Recommendations === payload.type) {
        const testIds = [...new Set(payload.content.benchmarks.map(({ testId }) => testId))];
        const createdRecommendations = testIds.length
          ? await this.recommendationsService.createMany({ conversationId, testIds }) : [];
        const recommendations = testIds.flatMap((testId) =>
          createdRecommendations.filter((recommendation) => recommendation.testId === testId)
        );
        const saved = await this.repository.createMessage({
          id: payload.eventId, conversationId, role: MessageRole.agent,
          kind: MessageKind.text, content: payload.content.label,
          options: { kind: 'recommendations', benchmarks: payload.content.benchmarks },
        });
        if (payload.eventId) this.agent.acknowledgeMessage?.(conversationId, payload.eventId);
        onAgent({ ...payload, id: saved.id, conversationId, recommendations });
      } else if (AgentMessageType.Question === payload.type) {
        const saved = await this.repository.createMessage({
          id: payload.eventId,
          conversationId,
          role: MessageRole.agent,
          kind: MessageKind.question,
          content: payload.content.label,
          optionId: payload.content.questionKey ?? null,
          options: payload.content.options ?? null,
          interviewState: payload.content.interviewState ?? null,
        });

        if (payload.eventId) this.agent.acknowledgeMessage?.(conversationId, payload.eventId);
        onAgent({ ...payload, id: saved.id, conversationId });
      } else if (AgentMessageType.Result === payload.type) {
        const saved = await this.repository.createMessage({
          id: payload.eventId,
          conversationId,
          role: MessageRole.agent,
          kind: MessageKind.result,
          content: payload.content.label,
          optionId: null,
          options: {
            ...(payload.content.testId
              ? { testId: payload.content.testId }
              : {}),
            status: payload.content.status,
            ...(payload.content.generationJobId
              ? { generationJobId: payload.content.generationJobId }
              : {}),
          },
        });

        if (payload.eventId) this.agent.acknowledgeMessage?.(conversationId, payload.eventId);
        onAgent({ ...payload, id: saved.id, conversationId });
      } else if (AgentMessageType.Hypotheses === payload.type) {
        const saved = await this.repository.createMessage({
          id: payload.eventId,
          conversationId,
          role: MessageRole.agent,
          kind: MessageKind.text,
          content: `hypotheses:${payload.content.hypotheses.length}`,
          optionId: null,
          options: { testId: payload.content.testId },
        });

        const generation = await this.hypothesesService.createGeneration({
          conversationId,
          testId: payload.content.testId,
          hypotheses: payload.content.hypotheses,
        });

        onHypotheses?.(generation);
        if (payload.eventId) this.agent.acknowledgeMessage?.(conversationId, payload.eventId);
        onAgent({ ...payload, id: saved.id, conversationId });
      }
    } catch (error) {
      const message = (error as Error).message ?? 'Internal error';
      this.logger.error(
        `Failed to process agent message for conversationId="${conversationId}": ${message}`
      );
      // даём фронту знать про ошибку
      onAgent({
        type: AgentMessageType.Error,
        isFinal: true,
        conversationId,
        content: { message },
      });
      this.closeSession(conversationId);
    }
  }

  private assertAgentPayload(
    payload: AgentMessagePayload
  ): asserts payload is Extract<
    AgentMessagePayload,
    { type: AgentMessageType.Question | AgentMessageType.Result | AgentMessageType.Hypotheses |
      AgentMessageType.Message | AgentMessageType.Recommendations }
  > {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid agent payload: not an object');
    }
    if (
      payload.type !== AgentMessageType.Question &&
      payload.type !== AgentMessageType.Result &&
      payload.type !== AgentMessageType.Hypotheses &&
      payload.type !== AgentMessageType.Message &&
      payload.type !== AgentMessageType.Recommendations
    ) {
      throw new Error(`Invalid agent payload: unknown type "${String((payload as { type?: unknown }).type)}"`);
    }
    if (!payload.content || typeof payload.content !== 'object') {
      throw new Error('Invalid agent payload: missing content');
    }
  }

  /** Сборка истории Interviewer: сообщения плюс исходные поисковые запросы. */
  private async buildHistory(conversationId: string, userId: string): Promise<HistoryEntry[]> {
    const conversation = await this.repository.findByIdWithMessages(conversationId, userId);
    if (!conversation) return [];

    return [
      ...conversation.messages.map((message: Message) => ({
        createdAt: message.createdAt,
        stableId: message.id,
        entry: { ...this.toHistoryEntry(message), id: message.id },
      })),
      ...conversation.recommendationRequests.map((request) => ({
        createdAt: request.createdAt,
        stableId: request.id,
        entry: {
          role: MessageRole.user,
          content: {
            kind: MessageKind.text,
            label: request.query,
          },
        } satisfies HistoryEntry,
      })),
    ]
      .sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.stableId.localeCompare(right.stableId)
      )
      .map(({ entry }) => entry);
  }

  private toHistoryEntry(m: Message): HistoryEntry {
    if (m.role === MessageRole.agent && m.kind === MessageKind.text) {
      const options = m.options as { kind?: string; benchmarks?: { testId: string; explanation?: string }[] } | null;
      return { role: MessageRole.agent,
        content: 'recommendations' === options?.kind && Array.isArray(options.benchmarks)
          ? { kind: 'recommendations', label: m.content, benchmarks: options.benchmarks }
          : { kind: 'text', label: m.content } };
    }
    if (m.role === MessageRole.agent && m.kind === MessageKind.result) {
      const opts = (m.options ?? {}) as {
        testId?: string;
        benchmarkId?: string;
        status?: AgentResultContent['status'];
        generationJobId?: string;
      };
      const testId = opts.testId ?? opts.benchmarkId;

      if (!opts.status) {
        this.logger.warn(
          `Corrupted result message options: messageId="${m.id}" conversationId="${m.conversationId}" options=${JSON.stringify(m.options)}`
        );
      }

      return {
        role: MessageRole.agent,
        content: {
          kind: MessageKind.result,
          label: m.content,
          ...(testId ? { testId } : {}),
          ...(opts.generationJobId ? { generationJobId: opts.generationJobId } : {}),
          status: opts.status ?? 'done',
        },
      };
    }

    if (m.role === MessageRole.agent) {
      const options =
        Array.isArray(m.options) && m.options.length > 0
          ? (m.options as unknown as AgentMessageOption[])
          : null;

      const content: AgentQuestionContent = {
        kind: MessageKind.question,
        label: m.content,
        ...(m.optionId ? { questionKey: m.optionId } : {}),
        ...(m.interviewState && 'object' === typeof m.interviewState && !Array.isArray(m.interviewState)
          ? { interviewState: m.interviewState as Record<string, string> } : {}),
        ...(options ? { options } : {}),
      };

      return { role: MessageRole.agent, content };
    }

    if (m.kind === MessageKind.option && m.optionId) {
      return {
        role: MessageRole.user,
        content: { kind: MessageKind.option, id: m.optionId, label: m.content },
      };
    }

    if (m.kind === MessageKind.recommendation_selected) {
      return {
        role: MessageRole.user,
        content: {
          kind: MessageKind.recommendation_selected,
          testId: m.content,
        },
      };
    }

    if (m.kind === MessageKind.recommendation_rejected) {
      return {
        role: MessageRole.user,
        content: {
          kind: MessageKind.recommendation_rejected,
          testId: m.content,
        },
      };
    }

    return {
      role: MessageRole.user,
      content: { kind: MessageKind.text, label: m.content },
    };
  }

}
