import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { DemoRequest, presentDemoRequest } from './demo-request';
import { AgentMockService } from './mock/agent.mock.service';
import { CreateMessageInput, IConversationsRepository } from './repository/conversations.repository.interface';
import { ConversationResponseState, latestResponseState, messageResponseState } from './response-state';
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
  ResponseStateHandler,
  RetryResponseParams,
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

  /** Local session identity prevents queued output from closing a replacement transport. */
  private readonly activeSessions = new Map<string, symbol>();
  private readonly responseStateHandlers = new Map<string, ResponseStateHandler>();
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
    private readonly recommendationsService: RecommendationsService,
    private readonly config: ConfigService = new ConfigService()
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

    if (await this.repository.isFrozen(params.conversationId, params.userId)) throw new ForbiddenException('Completed DEMO conversations are read-only');

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

  async findSidebar(page: number, user: RequestUser) {
    return this.repository.findSidebar(page, user.id);
  }

  async findArchived(page: number, user: RequestUser) {
    return this.repository.findArchived(page, user.id);
  }

  async findByIdWithMessages(
    id: string,
    user: RequestUser
  ): Promise<ConversationWithMessages & { responseState: ConversationResponseState | null; demoRequest?: DemoRequest }> {
    const conversation = await this.repository.findByIdWithMessages(id, user.id);
    if (!conversation) {
      throw new NotFoundException(`Conversation "${id}" was not found`);
    }
    const prepared = presentDemoRequest(conversation.agentContext);
    const mockResult = this.agent instanceof AgentMockService && 'dev' === this.config.get<string>('nodeEnv') && conversation.messages.find(message =>
      'agent' === message.role && 'result' === message.kind &&
      message.options && !Array.isArray(message.options) && 'object' === typeof message.options &&
      'mock_draft_ready' === message.options.resultKey);
    const candidate = prepared ?? (mockResult ? { status: 'ready' as const, revision: mockResult.id } : null);
    const demoRequest = candidate && 'prepare_only' === (await this.repository.getAgentContext(id))?.executionMode
      ? candidate : null;
    return {
      ...conversation,
      ...(demoRequest ? { demoRequest } : {}),
      responseState: latestResponseState(conversation.messages),
      messages: conversation.messages.map((message) => ({
        ...message,
        options: messageResponseState(message) ? null : presentTestTargetObject(message.options),
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

  async deleteConversation(id: string, user: RequestUser): Promise<void> {
    await this.repository.softDelete(id, user.id);
    this.closeSession(id);
  }

  async updateConversation(
    id: string,
    user: RequestUser,
    data: { title?: string; isArchived?: boolean; isPinned?: boolean }
  ) {
    const conversation = await this.repository.findByIdUnsafe(id);
    if (!conversation) {
      throw new NotFoundException(`Conversation "${id}" was not found`);
    }
    if (conversation.userId !== user.id) {
      throw new ForbiddenException(`Access denied to conversation "${id}"`);
    }

    const updateData: { title?: string; isArchived?: boolean; pinnedDate?: Date | null } = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.isArchived !== undefined) updateData.isArchived = data.isArchived;
    if (true === data.isPinned && !conversation.pinnedDate) updateData.pinnedDate = new Date();
    if (false === data.isPinned && conversation.pinnedDate) updateData.pinnedDate = null;

    if (0 === Object.keys(updateData).length) {
      const { agentContext, ...rest } = conversation;
      void agentContext;
      return rest;
    }

    try {
      const updated = await this.repository.update(id, user.id, updateData);
      const { agentContext, ...rest } = updated;
      void agentContext;
      return rest;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        'P2025' === error.code
      ) {
        throw new NotFoundException(`Conversation "${id}" was not found`);
      }
      throw error;
    }
  }

  async getAgentContext(id: string) {
    const conversation = await this.repository.getAgentContext(id);
    if (!conversation) throw new NotFoundException(`Conversation "${id}" was not found`);
    return { context: conversation.agentContext ?? null, executionMode: conversation.executionMode };
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

    if (await this.repository.isFrozen(conversationId, params.userId)) {
      this.closeSession(conversationId);
      return conversationId;
    }

    if (conversation.status === ConversationStatus.abandoned) {
      return conversationId;
    }

    const wasActive = this.activeSessions.has(conversationId);
    const detail = wasActive ? null : await this.repository.findByIdWithMessages(conversationId, params.userId);
    if ('failed' === latestResponseState(detail?.messages ?? [])?.status) return conversationId;
    this.openSession(conversationId, params.onAgent, params.onHypotheses);
    if (params.onResponseState) this.responseStateHandlers.set(conversationId, params.onResponseState);
    if (wasActive) return conversationId;

    const history = await this.buildHistory(conversationId, params.userId, detail);
    const initPayload: AgentInitPayload = {
      type: 'init',
      conversationId,
      intent: conversation.intent,
      history,
      resume: false,
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
    if (await this.repository.isFrozen(params.conversationId, params.userId)) throw new ForbiddenException('Completed DEMO conversations are read-only');

    if (conversation.status === ConversationStatus.abandoned) {
      throw new BadRequestException(
        `Conversation "${params.conversationId}" cannot accept messages in "${conversation.status}" status`
      );
    }

    if (conversation.status === ConversationStatus.awaiting_choice) {
      await this.repository.updateStatus(params.conversationId, ConversationStatus.active);
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

    const accepted = await this.repository.createUserResponse({
      id: params.requestId ?? randomUUID(), userId: params.userId,
      conversationId: params.conversationId,
      role: MessageRole.user,
      kind: persistedKind,
      content: persistedContent,
      optionId: persistedOptionId,
      options: null,
    });
    (params.onResponseState ?? this.responseStateHandlers.get(params.conversationId))?.({
      conversationId: params.conversationId, responseState: accepted.responseState,
    });
    if (!accepted.created) return;

    if (params.onResponseState) this.responseStateHandlers.set(params.conversationId, params.onResponseState);
    try {
      if (!this.activeSessions.has(params.conversationId)) {
        this.openSession(params.conversationId, params.onAgent, params.onHypotheses);
        const history = await this.buildHistory(params.conversationId, params.userId);
        this.agent.send(params.conversationId, {
          type: 'init', conversationId: params.conversationId, intent: conversation.intent,
          history: history.filter((entry) => entry.id !== accepted.message.id), resume: false,
        });
      }
    } catch (error) {
      await this.failUndispatchedResponse(params.conversationId, accepted.responseState, error);
      return;
    }

    this.agent.send(params.conversationId, {
      type: 'message',
      content,
      requestId: accepted.message.id,
      attempt: accepted.responseState.attempt,
    });
    if (params.kind === MessageKind.recommendation_rejected) {
      await this.repository.updateIntent(params.conversationId, ConversationIntent.create_new);
    }
  }

  async retryResponse(params: RetryResponseParams): Promise<void> {
    const accepted = await this.repository.retryResponse(
      params.conversationId, params.userId, params.userMessageId, params.expectedAttempt
    );
    (params.onResponseState ?? this.responseStateHandlers.get(params.conversationId))?.({
      conversationId: params.conversationId, responseState: accepted.responseState,
    });
    if (!accepted.started) return;

    this.closeSession(params.conversationId);
    if (params.onResponseState) this.responseStateHandlers.set(params.conversationId, params.onResponseState);
    let init: AgentInitPayload;
    try {
      const detail = await this.repository.findByIdWithMessages(params.conversationId, params.userId);
      if (!detail) throw new NotFoundException('Conversation was not found');
      const history = await this.buildHistory(params.conversationId, params.userId, detail);
      this.openSession(params.conversationId, params.onAgent, params.onHypotheses);
      init = { type: 'init', conversationId: params.conversationId, intent: detail.intent, history,
        resume: true, requestId: params.userMessageId, attempt: accepted.responseState.attempt };
    } catch (error) {
      await this.failUndispatchedResponse(params.conversationId, accepted.responseState, error);
      return;
    }
    // Once dispatch starts, a transport failure is ambiguous; keep pending until a correlated result.
    this.agent.send(params.conversationId, init);
  }

  private async failUndispatchedResponse(conversationId: string, state: ConversationResponseState, error: unknown): Promise<void> {
    this.logger.warn(`Response was not dispatched for conversationId="${conversationId}": ${String(error)}`);
    const handler = this.responseStateHandlers.get(conversationId);
    const responseState = await this.repository.completeResponse(conversationId, state.requestId, state.attempt, 'failed', {
      code: 'AGENT_RESPONSE_FAILED', message: 'Не удалось получить ответ. Повторите попытку.', retryable: true,
    });
    if (responseState) handler?.({ conversationId, responseState });
    this.closeSession(conversationId);
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
    if (await this.repository.isFrozen(params.conversationId, params.userId)) throw new ForbiddenException('Completed DEMO conversations are read-only');

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
    if (await this.repository.isFrozen(params.conversationId, params.userId)) throw new ForbiddenException('Completed DEMO conversations are read-only');
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
        await this.sendUserMessage({ ...params, kind: 'text', value: params.initialMessage?.trim() || 'Хочу создать свой бенчмарк.' });
      }
    }
  }

  /** Корректно закрыть сессию (по disconnect или isFinal). */
  closeSession(conversationId: string, expectedSession?: symbol): void {
    if (expectedSession && this.activeSessions.get(conversationId) !== expectedSession) return;
    this.responseStateHandlers.delete(conversationId);
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
    const session = this.activeSessions.get(conversationId) ?? Symbol(conversationId);
    const subscribe = (payload: AgentMessagePayload): void => {
      const previous = this.messageProcessing.get(conversationId) ??
        Promise.resolve();
      const current = previous.catch(() => undefined).then(() =>
        this.handleAgentMessage(
          conversationId,
          payload,
          onAgent,
          onHypotheses,
          session
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
    this.activeSessions.set(conversationId, session);
  }

  private async handleAgentMessage(
    conversationId: string,
    payload: AgentMessagePayload,
    onAgent: AgentMessageHandler,
    onHypotheses: HypothesesGeneratedHandler | undefined,
    session: symbol
  ): Promise<void> {
    try {
      // Ignore stale frames from a transport that has already been closed.
      if (this.activeSessions.get(conversationId) !== session) return;
      let responseState: ConversationResponseState | null = null;
      if (payload.requestId && payload.attempt) {
        responseState = await this.repository.findResponseState(conversationId, payload.requestId);
        // A failed or superseded attempt must not create messages, recommendations or jobs.
        if (!responseState || responseState.attempt !== payload.attempt || 'failed' === responseState.status) return;
      }
      if (AgentMessageType.Progress === payload.type) {
        if ('pending' !== responseState?.status) return;
        if (payload.content.stage) {
          const saved = await this.repository.updateResponseProgress(conversationId, payload.requestId, payload.attempt,
            { stage: payload.content.stage, message: payload.content.message });
          if (saved && this.activeSessions.get(conversationId) === session) this.responseStateHandlers.get(conversationId)?.({
            conversationId, responseState: saved,
          });
        } else onAgent({ ...payload, conversationId });
        return;
      }

      if (AgentMessageType.Error === payload.type) {
        if ('responded' === responseState?.status) {
          await this.saveWorkflowError(conversationId, payload, onAgent);
          return;
        }
        const failed = await this.recordResponse(conversationId, payload, 'failed');
        if (payload.requestId && !failed) {
          const current = await this.repository.findResponseState(conversationId, payload.requestId);
          if ('responded' === current?.status && current.attempt === payload.attempt) {
            await this.saveWorkflowError(conversationId, payload, onAgent);
          }
          return;
        }
        if (this.activeSessions.get(conversationId) !== session) return;
        if (!payload.requestId) {
          onAgent({ ...payload, conversationId, content: { message: 'Соединение с сервисом ответов прервано.' } });
        }
        this.closeSession(conversationId, session);
        return;
      }

      this.assertAgentPayload(payload);

      if (AgentMessageType.Message === payload.type) {
        const saved = await this.saveAgentMessage(payload, {
          id: payload.eventId, conversationId, role: MessageRole.agent,
          kind: MessageKind.text, content: payload.content.label, options: null,
        });
        if (!saved || this.activeSessions.get(conversationId) !== session) return;
        if (payload.eventId) this.agent.acknowledgeMessage?.(conversationId, payload.eventId);
        onAgent({ ...payload, id: saved.id, conversationId });
      } else if (AgentMessageType.Recommendations === payload.type) {
        const saved = await this.saveAgentMessage(payload, {
          id: payload.eventId, conversationId, role: MessageRole.agent,
          kind: MessageKind.text, content: payload.content.label,
          options: { kind: 'recommendations', benchmarks: payload.content.benchmarks },
        });
        if (!saved || this.activeSessions.get(conversationId) !== session) return;
        const testIds = [...new Set(payload.content.benchmarks.map(({ testId }) => testId))];
        const createdRecommendations = testIds.length
          ? await this.recommendationsService.createMany({ conversationId, testIds }) : [];
        const recommendations = testIds.flatMap((testId) =>
          createdRecommendations.filter((recommendation) => recommendation.testId === testId)
        );
        if (payload.eventId) this.agent.acknowledgeMessage?.(conversationId, payload.eventId);
        onAgent({ ...payload, id: saved.id, conversationId, recommendations });
      } else if (AgentMessageType.Question === payload.type) {
        const saved = await this.saveAgentMessage(payload, {
          id: payload.eventId,
          conversationId,
          role: MessageRole.agent,
          kind: MessageKind.question,
          content: payload.content.label,
          optionId: payload.content.questionKey ?? null,
          options: payload.content.options ?? null,
          interviewState: payload.content.interviewState ?? null,
        });
        if (!saved || this.activeSessions.get(conversationId) !== session) return;

        if (payload.eventId) this.agent.acknowledgeMessage?.(conversationId, payload.eventId);
        onAgent({ ...payload, id: saved.id, conversationId });
      } else if (AgentMessageType.Result === payload.type) {
        const saved = await this.saveAgentMessage(payload, {
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
            ...(payload.content.resultKey ? { resultKey: payload.content.resultKey } : {}),
            ...(payload.content.generationJobId
              ? { generationJobId: payload.content.generationJobId }
              : {}),
          },
        });
        if (!saved || this.activeSessions.get(conversationId) !== session) return;

        if (payload.eventId) this.agent.acknowledgeMessage?.(conversationId, payload.eventId);
        onAgent({ ...payload, id: saved.id, conversationId });
      } else if (AgentMessageType.Hypotheses === payload.type) {
        const saved = await this.saveAgentMessage(payload, {
          id: payload.eventId,
          conversationId,
          role: MessageRole.agent,
          kind: MessageKind.text,
          content: `hypotheses:${payload.content.hypotheses.length}`,
          optionId: null,
          options: { testId: payload.content.testId },
        });
        if (!saved || this.activeSessions.get(conversationId) !== session) return;

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
      if (this.activeSessions.get(conversationId) !== session) return;
      if (error instanceof NotFoundException) {
        this.closeSession(conversationId, session);
        return;
      }
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
      this.closeSession(conversationId, session);
    }
  }

  private async saveWorkflowError(conversationId: string,
    payload: Extract<AgentMessagePayload, { type: AgentMessageType.Error }>, onAgent: AgentMessageHandler): Promise<void> {
    const label = 'Не удалось завершить ответ. Уже полученные результаты сохранены.';
    if (!payload.eventId) {
      onAgent({ ...payload, conversationId, content: { message: label } });
      return;
    }
    const saved = await this.saveAgentMessage(payload, {
      id: payload.eventId, conversationId, role: MessageRole.agent, kind: MessageKind.text, content: label,
      options: { kind: 'workflow_error', requestId: payload.requestId!, attempt: payload.attempt! },
    });
    if (saved) onAgent({ type: AgentMessageType.Message, isFinal: false, id: saved.id, conversationId,
      requestId: payload.requestId, attempt: payload.attempt, content: { kind: 'text', label } });
    // A late workflow error must not close a newer turn on the same session.
  }

  private async saveAgentMessage(payload: AgentMessagePayload, data: CreateMessageInput): Promise<Message | null> {
    const meaningful = AgentMessageType.Hypotheses === payload.type ? payload.content.hypotheses.length > 0
      : AgentMessageType.Error !== payload.type && AgentMessageType.Progress !== payload.type && (Boolean(payload.content.label.trim()) ||
        (AgentMessageType.Recommendations === payload.type && payload.content.benchmarks.length > 0));
    const saved = await this.repository.createMessage({ ...data,
      ...(payload.requestId && payload.attempt ? {
        response: { requestId: payload.requestId, attempt: payload.attempt,
          ...(!meaningful || false === payload.turnComplete ? { settle: false } : {}) },
      } : {}),
    });
    if (saved?.responseState) this.responseStateHandlers.get(data.conversationId)?.({
      conversationId: data.conversationId, responseState: saved.responseState,
    });
    return saved;
  }

  private async recordResponse(conversationId: string, payload: AgentMessagePayload,
    status: 'responded' | 'failed'): Promise<ConversationResponseState | null> {
    // Uncorrelated transport failures cannot prove that the remote turn stopped.
    if (!payload.requestId || !payload.attempt) return null;
    const responseState = await this.repository.completeResponse(conversationId, payload.requestId, payload.attempt, status,
      'failed' === status ? { code: 'AGENT_RESPONSE_FAILED', message: 'Не удалось получить ответ. Повторите попытку.', retryable: true } : null);
    if (responseState) this.responseStateHandlers.get(conversationId)?.({ conversationId, responseState });
    return responseState;
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
  private async buildHistory(conversationId: string, userId: string, detail?: ConversationWithMessages | null): Promise<HistoryEntry[]> {
    const conversation = detail ?? await this.repository.findByIdWithMessages(conversationId, userId);
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
        resultKey?: AgentResultContent['resultKey'];
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
          ...(opts.resultKey ? { resultKey: opts.resultKey } : {}),
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
