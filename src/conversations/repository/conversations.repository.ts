import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PaginationDto } from '@/common/dtos/paginationDto.dto';
import { InfiniteDataResponseType } from '@/common/types/infiniteDataResponse.type';
import {
  Conversation,
  ConversationIntent,
  ConversationStatus,
  Message,
  Prisma,
} from '@/generated/prisma/client';
import { stableStringify } from '@/generation/job-contract';
import { PrismaService } from '@/prisma/prisma.service';
import { assertMutableConversation, isFrozenConversation, lockConversation } from '../conversation-access';
import { BriefProgress, ConversationResponseState, messageResponseState, responseOptions } from '../response-state';
import { ConversationWithMessages, conversationFullInclude } from '../types';
import {
  CreateMessageInput,
  IConversationsRepository,
} from './conversations.repository.interface';

@Injectable()
export class ConversationsRepository implements IConversationsRepository {
  private readonly logger = new Logger(ConversationsRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async isFrozen(id: string, userId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => isFrozenConversation(await lockConversation(tx, id, userId)));
  }

  async softDelete(id: string, userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ isDeleted: boolean }>>`
        SELECT is_deleted AS "isDeleted" FROM conversations
        WHERE id = CAST(${id} AS uuid) AND user_id = ${userId} FOR UPDATE
      `;
      if (!rows[0]) throw new NotFoundException('Conversation was not found');
      if (rows[0].isDeleted) return;
      await tx.conversation.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } });
      await tx.$executeRaw`
        UPDATE benchmark_creator_jobs SET status = 'cancelled', lease_token = NULL,
          lease_expires_at = NULL, updated_at = now()
        WHERE interview_session_id = ${id} AND status IN ('accepted', 'running')
      `;
      await tx.$executeRaw`
        UPDATE benchmark_producer_jobs SET status = 'failed', lease_token = NULL,
          lease_expires_at = NULL, updated_at = now()
        WHERE interview_session_id = ${id} AND status IN ('accepted', 'running')
      `;
    });
  }

  async createConversation(userId: string): Promise<Conversation> {
    const conversation = await this.prisma.conversation.create({
      data: {
        userId,
      },
    });

    this.logger.log(`Conversation created: id="${conversation.id}"`);

    return conversation;
  }

  async findAll(
    queryParams: PaginationDto,
    userId: string
  ): Promise<InfiniteDataResponseType<Conversation>> {
    this.assertOwnerId(userId);
    const { page, limit } = queryParams;

    this.logger.debug(
      `Fetching conversations: page=${page}, limit=${limit}`
    );

    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where: { userId, isDeleted: false },
        orderBy: [{ pinnedDate: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.conversation.count({
        where: { userId, isDeleted: false },
      }),
    ]);

    this.logger.debug(
      `Fetched conversations: returned=${data.length}, total=${total}`
    );

    return { data, total };
  }

  async findSidebar(page: number, userId: string) {
    this.assertOwnerId(userId);
    const active = { userId, isArchived: false, isDeleted: false };
    const history = { ...active, pinnedDate: null };
    const historyPage = this.prisma.conversation.findMany({
      where: history,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * 20,
      take: 20,
    });
    const historyTotal = this.prisma.conversation.count({ where: history });
    if (page > 1) {
      const [data, total] = await this.prisma.$transaction([historyPage, historyTotal]);
      return { pinned: [], data, total, pageSize: 20 };
    }
    const [pinned, data, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where: { ...active, pinnedDate: { not: null } },
        orderBy: [{ pinnedDate: 'desc' }, { id: 'desc' }],
      }),
      historyPage,
      historyTotal,
    ]);
    return { pinned, data, total, pageSize: 20 };
  }

  async findArchived(page: number, userId: string) {
    this.assertOwnerId(userId);
    const where = { userId, isArchived: true, isDeleted: false };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 20,
        take: 20,
      }),
      this.prisma.conversation.count({ where }),
    ]);
    return { data, total, pageSize: 20 };
  }

  async findByIdWithMessages(
    id: string,
    userId: string
  ): Promise<Nullable<ConversationWithMessages>> {
    this.assertOwnerId(userId);
    return this.prisma.conversation.findFirst({
      where: { id, userId, isDeleted: false },
      include: conversationFullInclude,
    });
  }

  async findById(id: string, userId: string): Promise<Nullable<Conversation>> {
    this.assertOwnerId(userId);
    return this.prisma.conversation.findFirst({
      where: { id, userId, isDeleted: false },
    });
  }

  async findByIdUnsafe(id: string): Promise<Conversation | null> {
    return this.prisma.conversation.findFirst({ where: { id, isDeleted: false } });
  }

  async update(
    id: string,
    userId: string,
    data: { title?: string; isArchived?: boolean; pinnedDate?: Date | null }
  ): Promise<Conversation> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, isDeleted: false },
    });
    if (!conversation || conversation.userId !== userId) {
      throw new NotFoundException(`Conversation "${id}" was not found`);
    }
    return this.prisma.$transaction(async (tx) => {
      const locked = await lockConversation(tx, id, userId);
      if (data.title !== undefined || data.isArchived !== undefined) assertMutableConversation(locked);
      return tx.conversation.update({ where: { id }, data });
    });
  }

  private assertOwnerId(userId: string): void {
    if (!userId) {
      throw new Error('Conversation owner ID is required');
    }
  }

  async createMessage(data: CreateMessageInput): Promise<(Message & { responseState?: ConversationResponseState | null }) | null> {
    const response = data.response;
    if (response) {
      return this.prisma.$transaction(async (tx) => {
        const conversation = await lockConversation(tx, data.conversationId);
        if (!this.canPersistAgentOutput(conversation, data)) return null;
        await tx.$queryRaw`SELECT id FROM messages WHERE id = ${response.requestId}::uuid FOR UPDATE`;
        const user = await tx.message.findFirst({ where: { id: response.requestId, conversationId: data.conversationId, role: 'user' } });
        const state = user ? messageResponseState(user) : null;
        if (!state || state.attempt !== response.attempt || 'failed' === state.status) return null;
        const message = await this.persistMessage(tx, data);
        const responseState = false === response.settle ? null
          : await this.completeResponseOn(tx, data.conversationId, response.requestId, response.attempt, 'responded');
        return { ...message, responseState };
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const conversation = await lockConversation(tx, data.conversationId);
      return this.canPersistAgentOutput(conversation, data) ? this.persistMessage(tx, data) : null;
    });
  }

  private canPersistAgentOutput(conversation: Awaited<ReturnType<typeof lockConversation>>, data: CreateMessageInput): boolean {
    if (!isFrozenConversation(conversation)) return true;
    // The first ready checkpoint precedes its correlated terminal result/outbox acknowledgement.
    const options = data.options as Record<string, unknown> | null | undefined;
    const context = conversation.agentContext as Prisma.JsonObject | null;
    const pending = context?.pending_output;
    return 'agent' === data.role && 'completed' !== conversation.status &&
      'result' === data.kind && 'brief_ready' === options?.status && Array.isArray(pending) &&
      pending.some((value) => {
        const output = value as Prisma.JsonObject | null;
        const content = output?.content as Prisma.JsonObject | null;
        return !!output && !!data.id && output.eventId === data.id && 'brief_ready' === content?.status && content.label === data.content &&
          (!data.response || (output.requestId === data.response.requestId && output.attempt === data.response.attempt));
      });
  }

  private async persistMessage(db: Prisma.TransactionClient, data: CreateMessageInput): Promise<Message> {
    const message = {
      ...(data.id ? { id: data.id } : {}),
      conversationId: data.conversationId,
      role: data.role,
      kind: data.kind,
      content: data.content,
      optionId: data.optionId ?? null,
      interviewState: data.interviewState ?? Prisma.DbNull,
      options:
          data.options === undefined || null === data.options
            ? Prisma.JsonNull
            : data.options,
    } satisfies Prisma.MessageUncheckedCreateInput;
    const created = data.id
      ? (await db.message.createManyAndReturn({ data: message, skipDuplicates: true }))[0]
      : await db.message.create({ data: message });
    if (!created) {
      return db.message.findUniqueOrThrow({
        where: { id: data.id, conversationId: data.conversationId },
      });
    }
    await db.conversation.update({
      where: { id: data.conversationId },
      data: { updatedAt: new Date() },
    });
    return created;
  }

  async createUserResponse(data: CreateMessageInput & { id: string; userId: string }) {
    return this.prisma.$transaction(async (tx) => {
      // Serialize sends for one owner/conversation before inserting a new user turn.
      assertMutableConversation(await lockConversation(tx, data.conversationId, data.userId));
      const existing = await tx.message.findUnique({ where: { id: data.id } });
      if (existing) {
        const responseState = messageResponseState(existing);
        if (!responseState || existing.conversationId !== data.conversationId || existing.kind !== data.kind ||
            existing.content !== data.content || existing.optionId !== (data.optionId ?? null)) {
          throw new ConflictException('Message ID has already been used for another request');
        }
        return { message: existing, responseState, created: false };
      }
      const latestUser = await tx.message.findFirst({
        where: { conversationId: data.conversationId, role: 'user' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (latestUser && 'pending' === messageResponseState(latestUser)?.status) {
        throw new ConflictException('Wait for the pending reply before sending another message');
      }
      const responseState: ConversationResponseState = {
        requestId: data.id, userMessageId: data.id, status: 'pending', attempt: 1, error: null, updatedAt: new Date().toISOString(),
      };
      const message = await tx.message.create({ data: {
        id: data.id, conversationId: data.conversationId, role: 'user', kind: data.kind,
        content: data.content, optionId: data.optionId ?? null, options: responseOptions(responseState),
        createdAt: new Date(Math.max(Date.now(), (latestUser?.createdAt.getTime() ?? 0) + 1)),
      } });
      await tx.conversation.update({
        where: { id: data.conversationId },
        data: { updatedAt: new Date() },
      });
      return { message, responseState, created: true };
    });
  }

  async completeResponse(conversationId: string, requestId: string, attempt: number,
    status: 'responded' | 'failed', error: ConversationResponseState['error'] = null): Promise<ConversationResponseState | null> {
    return this.completeResponseOn(this.prisma, conversationId, requestId, attempt, status, error);
  }

  async findResponseState(conversationId: string, requestId: string): Promise<ConversationResponseState | null> {
    const message = await this.prisma.message.findFirst({ where: { id: requestId, conversationId, role: 'user', conversation: { isDeleted: false } } });
    return message ? messageResponseState(message) : null;
  }

  async updateResponseProgress(conversationId: string, requestId: string, attempt: number,
    progress: Omit<BriefProgress, 'updatedAt'>): Promise<ConversationResponseState | null> {
    return this.prisma.$transaction(async (tx) => {
      await lockConversation(tx, conversationId);
      await tx.$queryRaw`SELECT id FROM messages WHERE id = ${requestId}::uuid FOR UPDATE`;
      const message = await tx.message.findFirst({ where: { id: requestId, conversationId, role: 'user' } });
      const previous = message ? messageResponseState(message) : null;
      if (!previous || 'pending' !== previous.status || previous.attempt !== attempt) return null;
      const latest = await tx.message.findFirst({
        where: { conversationId, role: 'user' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (latest?.id !== requestId) return null;
      const updatedAt = new Date(Math.max(Date.now(), Date.parse(previous.updatedAt) + 1)).toISOString();
      const state: ConversationResponseState = { ...previous, updatedAt, progress: { ...progress, updatedAt } };
      const updated = await tx.message.updateMany({ where: { id: requestId, conversationId, AND: [
        { options: { path: ['responseState', 'status'], equals: 'pending' } },
        { options: { path: ['responseState', 'attempt'], equals: attempt } },
      ] }, data: { options: responseOptions(state) } });
      return updated.count ? state : null;
    });
  }

  async retryResponse(conversationId: string, userId: string, userMessageId: string, expectedAttempt: number) {
    return this.prisma.$transaction(async (tx) => {
      const owned = await lockConversation(tx, conversationId, userId);
      assertMutableConversation(owned);
      if ('abandoned' === owned.status) throw new ConflictException('This conversation cannot accept a retry');
      const latestUser = await tx.message.findFirst({
        where: { conversationId, role: 'user' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const previous = latestUser ? messageResponseState(latestUser) : null;
      if (latestUser?.id !== userMessageId || !previous) {
        throw new ConflictException('Only the latest tracked message can be retried');
      }
      // Replayed commands from another tab must never launch a second attempt.
      if (previous.attempt > expectedAttempt) return { responseState: previous, started: false };
      if (previous.attempt !== expectedAttempt || 'failed' !== previous.status || !previous.error?.retryable) {
        throw new ConflictException('Only a confirmed failed response can be retried');
      }
      const { progress: oldProgress, ...prior } = previous;
      void oldProgress;
      const responseState: ConversationResponseState = { ...prior, status: 'pending', attempt: previous.attempt + 1,
        error: null, updatedAt: new Date(Math.max(Date.now(), Date.parse(previous.updatedAt) + 1)).toISOString() };
      const updated = await tx.message.updateMany({
        where: { id: userMessageId, conversationId, AND: [
          { options: { path: ['responseState', 'status'], equals: 'failed' } },
          { options: { path: ['responseState', 'attempt'], equals: expectedAttempt } },
        ] }, data: { options: responseOptions(responseState) },
      });
      if (!updated.count) throw new ConflictException('Response state changed; reload the conversation');
      return { responseState, started: true };
    });
  }

  private async completeResponseOn(db: Prisma.TransactionClient, conversationId: string, requestId: string, attempt: number,
    status: 'responded' | 'failed', error: ConversationResponseState['error'] = null): Promise<ConversationResponseState | null> {
    const message = await db.message.findUnique({ where: { id: requestId } });
    const previous = message ? messageResponseState(message) : null;
    if (message?.conversationId !== conversationId || previous?.status !== 'pending' || previous.attempt !== attempt) return null;
    const state: ConversationResponseState = {
      requestId, userMessageId: requestId, status, attempt, error,
      updatedAt: new Date(Math.max(Date.now(), Date.parse(previous.updatedAt) + 1)).toISOString(),
    };
    const updated = await db.message.updateMany({
      where: { id: requestId, conversationId, role: 'user', conversation: { isDeleted: false }, AND: [
        { options: { path: ['responseState', 'status'], equals: 'pending' } },
        { options: { path: ['responseState', 'attempt'], equals: attempt } },
      ] },
      data: { options: responseOptions(state) },
    });
    return updated.count ? state : null;
  }

  async getAgentContext(id: string) {
    const rows = await this.prisma.$queryRaw<Array<{
      agentContext: Prisma.JsonValue | null; executionMode: 'execute' | 'prepare_only';
    }>>`
      SELECT c.agent_context AS "agentContext",
        CASE WHEN u.role = 'DEMO' THEN 'prepare_only' ELSE 'execute' END AS "executionMode"
      FROM conversations c JOIN users u ON u.id::text = c.user_id
      WHERE c.id = CAST(${id} AS uuid) AND c.is_deleted = false
    `;
    return rows[0] ?? null;
  }

  updateAgentContext(id: string, context: Prisma.InputJsonObject): Promise<Conversation> {
    return this.prisma.$transaction(async (tx) => {
      const current = await lockConversation(tx, id);
      if (isFrozenConversation(current)) {
        const previous = current.agentContext as Prisma.JsonObject | null;
        // Outbox acknowledgement can change after the final result; the material cannot.
        for (const key of ['requirements', 'benchmark_name', 'prepared_brief', 'brief', 'creation_requested', 'ready']) {
          if (stableStringify(previous?.[key] ?? null) !== stableStringify(context[key] ?? null)) {
            throw new ConflictException('Completed DEMO material is read-only');
          }
        }
      }
      return tx.conversation.update({ where: { id }, data: { agentContext: context } });
    });
  }

  async updateStatus(
    id: string,
    status: ConversationStatus
  ): Promise<Conversation> {
    return this.prisma.$transaction(async (tx) => {
      assertMutableConversation(await lockConversation(tx, id));
      return tx.conversation.update({ where: { id }, data: { status } });
    });
  }

  async updateIntent(
    id: string,
    intent: ConversationIntent | null
  ): Promise<Conversation> {
    return this.prisma.$transaction(async (tx) => {
      assertMutableConversation(await lockConversation(tx, id));
      return tx.conversation.update({ where: { id }, data: { intent } });
    });
  }

  async completeWithRecommendation(
    id: string,
    testId: string
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      assertMutableConversation(await lockConversation(transaction, id));
      const transition = await transaction.conversation.updateMany({
        where: { id, status: { not: ConversationStatus.completed } },
        data: { status: ConversationStatus.completed },
      });
      if (0 === transition.count) return false;

      await transaction.message.create({
        data: {
          conversationId: id,
          role: 'user',
          kind: 'recommendation_selected',
          content: testId,
          options: Prisma.JsonNull,
        },
      });

      return true;
    });
  }

  async beginBenchmarkCreation(
    id: string,
    expectedIntent: ConversationIntent | null,
    rejectedTestId?: string
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      assertMutableConversation(await lockConversation(transaction, id));
      const transition = await transaction.conversation.updateMany({
        where: {
          id,
          intent: expectedIntent,
          status: { not: ConversationStatus.completed },
        },
        data: {
          intent: ConversationIntent.create_new,
          status: ConversationStatus.active,
        },
      });
      if (0 === transition.count) return false;

      if (rejectedTestId) {
        await transaction.message.create({
          data: {
            conversationId: id,
            role: 'user',
            kind: 'recommendation_rejected',
            content: rejectedTestId,
            options: Prisma.JsonNull,
          },
        });
      }

      return true;
    });
  }
}
