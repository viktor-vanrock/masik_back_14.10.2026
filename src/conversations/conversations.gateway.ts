import { Logger, UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { WsJwtAuthGuard } from '@/auth/jwt/ws-jwt-auth.guard';
import { WsCurrentUser } from '@/common/decorators/wsCurrentUser.decorator';
import { AgentMessageType } from '@/common/enums/agentMessageType.enum';
import { WsEvent } from '@/common/enums/wsEvents.enum';
import { RecommendationStatus } from '@/generated/prisma/enums';
import { HypothesisGenerationWithHypotheses } from '@/hypotheses/types';
import { RecommendationActionDto } from '@/recommendations/dto/recommendationAction.dto';
import { RecommendationsService } from '@/recommendations/recommendations.service';
import { ConversationsService } from './conversations.service';
import { RegenerateHypothesesDto } from './dto/regenerateHypotheses.dto';
import { RequestRecommendationsDto } from './dto/requestRecommendations.dto';
import { RetryResponseDto } from './dto/retryResponse.dto';
import { SendMessageDto } from './dto/sendMessage.dto';
import { StartBenchmarkCreationDto } from './dto/startBenchmarkCreation.dto';
import { StartChatDto } from './dto/startChat.dto';
import { AgentMessageWithId, ResponseStateHandler } from './types';
import type { RequestUser } from '@/common/types/request.type';

@UseGuards(WsJwtAuthGuard)
@WebSocketGateway({
  path: '/api/socket.io',
})
export class ConversationsGateway implements
    OnGatewayConnection,
    OnGatewayDisconnect
{
  private readonly logger = new Logger(ConversationsGateway.name);

  private readonly subscribers = new Map<string, Map<string, Socket>>();

  constructor(
    private readonly service: ConversationsService,
    private readonly recommendationsService: RecommendationsService,
    private readonly wsJwtAuthGuard: WsJwtAuthGuard
  ) {}

  handleConnection(client: Socket): void {
    const user = this.wsJwtAuthGuard.authenticate(client);
    if (!user) {
      client.disconnect(true);
      return;
    }

    client.data = { ...client.data, user };
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    for (const [conversationId, clients] of this.subscribers) {
      clients.delete(client.id);
      if (!clients.size) this.subscribers.delete(conversationId);
    }
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage(WsEvent.StartChat)
  async onStartChat(
    @ConnectedSocket() client: Socket,
    @WsCurrentUser() user: RequestUser,
    @MessageBody() body: StartChatDto
  ): Promise<void> {
    try {
      const conversationId = await this.service.startChat({
        conversationId: body?.conversationId,
        userId: user.id,
        onAgent: (payload) => this.pushAgentMessage(client, payload),
        onHypotheses: (generation) =>
          this.pushHypothesesGenerated(client, generation),
        onResponseState: (payload) => this.pushResponseState(client, payload),
      });

      this.bindSocket(client, conversationId);

      client.emit(WsEvent.ChatStarted, { conversationId });
    } catch (error) {
      this.handleError(client, error, 'Failed to start chat');
    }
  }

  @SubscribeMessage(WsEvent.SendMessage)
  async onSendMessage(
    @ConnectedSocket() client: Socket,
    @WsCurrentUser() user: RequestUser,
    @MessageBody() body: SendMessageDto
  ): Promise<void> {
    try {
      await this.service.sendUserMessage({
        userId: user.id,
        conversationId: body.conversationId,
        kind: body.kind,
        value: body.value,
        label: body.label,
        requestId: body.requestId,
        onAgent: (payload) => this.pushAgentMessage(client, payload),
        onHypotheses: (generation) =>
          this.pushHypothesesGenerated(client, generation),
        onResponseState: (payload) => this.pushResponseState(client, payload),
      });
      this.bindSocket(client, body.conversationId);
    } catch (error) {
      this.handleError(client, error, 'Failed to send message');
    }
  }

  @SubscribeMessage(WsEvent.RetryResponse)
  async onRetryResponse(
    @ConnectedSocket() client: Socket,
    @WsCurrentUser() user: RequestUser,
    @MessageBody() body: RetryResponseDto
  ): Promise<void> {
    try {
      await this.service.retryResponse({
        ...body, userId: user.id,
        onAgent: (payload) => this.pushAgentMessage(client, payload),
        onHypotheses: (generation) => this.pushHypothesesGenerated(client, generation),
        onResponseState: (payload) => this.pushResponseState(client, payload),
      });
      this.bindSocket(client, body.conversationId);
    } catch (error) {
      this.handleError(client, error, 'Failed to retry response');
    }
  }

  @SubscribeMessage(WsEvent.RequestRecommendations)
  async onRequestRecommendations(
    @ConnectedSocket() client: Socket,
    @WsCurrentUser() user: RequestUser,
    @MessageBody() body: RequestRecommendationsDto
  ) {
    try {
      const request = await this.service.requestRecommendations({
        /**
         * user.id пришёл из проверенного JWT.
         * Никогда не доверяем userId из клиентского body.
         */
        userId: user.id,
        conversationId: body.conversationId,
        query: body.query,
      });

      /**
       * Привязываем socket только после проверки владельца conversation.
       * Иначе пользователь мог бы привязаться к чужому ID.
       */
      this.bindSocket(client, request.conversationId);

      // Pending request уже сохранён в PostgreSQL до обращения к моделям.
      client.emit(WsEvent.RecommendationRequestAccepted, {
        requestId: request.id,
        conversationId: request.conversationId,
        status: request.status,
        createdAt: request.createdAt,
      });

      const result = await this.service.executeRecommendationRequest(request);
      client.emit(WsEvent.RecommendationResult, result);
    } catch (error) {
      this.handleError(
        client,
        error,
        'Failed to request recommendations'
      );
    }
  }

  @SubscribeMessage(WsEvent.SelectRecommendation)
  async onSelectRecommendation(
    @ConnectedSocket() client: Socket,
    @WsCurrentUser() user: RequestUser,
    @MessageBody() body: RecommendationActionDto
  ): Promise<void> {
    try {
      this.logger.log(
        `Selecting recommendation: id="${body.recommendationId}" clientId="${client.id}"`
      );

      const recommendation = await this.recommendationsService.findByIdForUser(
        body.recommendationId,
        user.id
      );
      this.bindSocket(client, recommendation.conversationId);

      const update = await this.recommendationsService.updateStatus({
        id: body.recommendationId,
        status: RecommendationStatus.selected,
      });

      client.emit(WsEvent.RecommendationUpdated, update.recommendation);
      if (!update.transitioned) return;
      await this.service.sendUserMessage({
        userId: user.id, conversationId: recommendation.conversationId,
        kind: 'recommendation_selected', value: recommendation.testId,
        onAgent: (payload) => this.pushAgentMessage(client, payload),
        onHypotheses: (generation) => this.pushHypothesesGenerated(client, generation),
      });
    } catch (error) {
      this.handleError(client, error, 'Failed to select recommendation');
    }
  }

  @SubscribeMessage(WsEvent.RejectRecommendation)
  async onRejectRecommendation(
    @ConnectedSocket() client: Socket,
    @WsCurrentUser() user: RequestUser,
    @MessageBody() body: RecommendationActionDto
  ): Promise<void> {
    try {
      this.logger.log(
        `Rejecting recommendation: id="${body.recommendationId}" clientId="${client.id}"`
      );

      const recommendation = await this.recommendationsService.findByIdForUser(
        body.recommendationId,
        user.id
      );
      this.bindSocket(client, recommendation.conversationId);

      const update = await this.recommendationsService.updateStatus({
        id: body.recommendationId,
        status: RecommendationStatus.rejected,
      });

      client.emit(WsEvent.RecommendationUpdated, update.recommendation);

      if (!update.transitioned) return;
      await this.service.sendUserMessage({
        userId: user.id,
        conversationId: recommendation.conversationId,
        kind: 'recommendation_rejected', value: recommendation.testId,
        onAgent: (payload) => this.pushAgentMessage(client, payload),
        onHypotheses: (generation) =>
          this.pushHypothesesGenerated(client, generation),
      });

    } catch (error) {
      this.handleError(client, error, 'Failed to reject recommendation');
    }
  }

  @SubscribeMessage(WsEvent.StartBenchmarkCreation)
  async onStartBenchmarkCreation(
    @ConnectedSocket() client: Socket,
    @WsCurrentUser() user: RequestUser,
    @MessageBody() body: StartBenchmarkCreationDto
  ): Promise<void> {
    try {
      await this.service.startBenchmarkCreation({
        userId: user.id,
        conversationId: body.conversationId,
        initialMessage: body.initialMessage,
        onAgent: (payload) => this.pushAgentMessage(client, payload),
        onHypotheses: (generation) =>
          this.pushHypothesesGenerated(client, generation),
      });
      this.bindSocket(client, body.conversationId);
      client.emit(WsEvent.BenchmarkCreationStarted, {
        conversationId: body.conversationId,
      });
    } catch (error) {
      this.handleError(client, error, 'Failed to start benchmark creation');
    }
  }

  @SubscribeMessage(WsEvent.RegenerateHypotheses)
  async onRegenerateHypotheses(
    @ConnectedSocket() client: Socket,
    @WsCurrentUser() user: RequestUser,
    @MessageBody() body: RegenerateHypothesesDto
  ): Promise<void> {
    try {
      this.logger.log(
        `Regenerating hypotheses: conversationId="${body.conversationId}" clientId="${client.id}"`
      );
      await this.service.regenerateHypotheses({
        userId: user.id,
        conversationId: body.conversationId,
        onAgent: (payload) => this.pushAgentMessage(client, payload),
        onHypotheses: (generation) =>
          this.pushHypothesesGenerated(client, generation),
      });
      this.bindSocket(client, body.conversationId);
    } catch (error) {
      this.handleError(client, error, 'Failed to regenerate hypotheses');
    }
  }

  private bindSocket(client: Socket, conversationId: string): void {
    for (const [previousId, clients] of this.subscribers) {
      if (previousId === conversationId) continue;
      clients.delete(client.id);
      if (!clients.size) this.subscribers.delete(previousId);
    }
    const clients = this.subscribers.get(conversationId) ?? new Map<string, Socket>();
    clients.set(client.id, client);
    this.subscribers.set(conversationId, clients);
  }

  private emitToSubscribers(client: Socket, conversationId: string | undefined, event: WsEvent, payload: unknown): void {
    const subscribers = conversationId ? this.subscribers.get(conversationId) : undefined;
    if (subscribers?.size) {
      for (const subscriber of subscribers.values()) subscriber.emit(event, payload);
      if (!subscribers.has(client.id) && client.connected !== false) client.emit(event, payload);
    } else if (client.connected !== false) client.emit(event, payload);
  }

  private pushResponseState(client: Socket, payload: Parameters<ResponseStateHandler>[0]): void {
    this.emitToSubscribers(client, payload.conversationId, WsEvent.ResponseState, payload);
  }

  private pushAgentMessage(
    client: Socket,
    payload: AgentMessageWithId
  ): void {
    if (AgentMessageType.Progress === payload.type) {
      this.emitToSubscribers(client, payload.conversationId, WsEvent.AgentProgress, {
        conversationId: payload.conversationId, requestId: payload.requestId, attempt: payload.attempt, message: payload.content.message,
      });
      return;
    }
    if (payload.type === AgentMessageType.Recommendations) {
      this.emitToSubscribers(client, payload.conversationId, WsEvent.RecommendationResult, {
        status: 'completed', requestId: payload.id, conversationId: payload.conversationId,
        retrievalVersion: 'interviewer-tool-v1', label: payload.content.label,
        recommendations: payload.recommendations, explanations: payload.content.benchmarks,
        ...(payload.turnComplete !== undefined ? { turnComplete: payload.turnComplete } : {}),
      });
      return;
    }
    this.emitToSubscribers(client, payload.conversationId, WsEvent.AgentMessage, payload);
  }

  private pushHypothesesGenerated(
    client: Socket,
    generation: HypothesisGenerationWithHypotheses
  ): void {
    client.emit(WsEvent.HypothesesGenerated, generation);
  }

  private handleError(client: Socket, error: unknown, fallback: string): void {
    const message =
      error instanceof Error && error.message ? error.message : fallback;
    this.logger.error(`${fallback}: ${message}`);
    client.emit(WsEvent.Error, { message });
  }

}
