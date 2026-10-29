import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PaginationDto } from '@/common/dtos/paginationDto.dto';
import { InfiniteDataResponseType } from '@/common/types/infiniteDataResponse.type';
import {
  Conversation,
  ConversationIntent,
  ConversationStatus,
  Message,
  Prisma,
} from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ConversationWithMessages, conversationFullInclude } from '../types';
import {
  CreateMessageInput,
  IConversationsRepository,
} from './conversations.repository.interface';

@Injectable()
export class ConversationsRepository implements IConversationsRepository {
  private readonly logger = new Logger(ConversationsRepository.name);

  constructor(private readonly prisma: PrismaService) {}

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
        where: { userId },
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.conversation.count({
        where: { userId },
      }),
    ]);

    this.logger.debug(
      `Fetched conversations: returned=${data.length}, total=${total}`
    );

    return { data, total };
  }

  async findByIdWithMessages(
    id: string,
    userId: string
  ): Promise<Nullable<ConversationWithMessages>> {
    this.assertOwnerId(userId);
    return this.prisma.conversation.findFirst({
      where: { id, userId },
      include: conversationFullInclude,
    });
  }

  async findById(id: string, userId: string): Promise<Nullable<Conversation>> {
    this.assertOwnerId(userId);
    return this.prisma.conversation.findFirst({
      where: { id, userId },
    });
  }

  async findByIdUnsafe(id: string): Promise<Conversation | null> {
    return this.prisma.conversation.findUnique({ where: { id } });
  }

  async update(
    id: string,
    userId: string,
    data: { title?: string; isArchived?: boolean; isPinned?: boolean }
  ): Promise<Conversation> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
    });
    if (!conversation || conversation.userId !== userId) {
      throw new NotFoundException(`Conversation "${id}" was not found`);
    }
    return this.prisma.conversation.update({
      where: { id },
      data,
    });
  }

  private assertOwnerId(userId: string): void {
    if (!userId) {
      throw new Error('Conversation owner ID is required');
    }
  }

  async createMessage(data: CreateMessageInput): Promise<Message> {
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
    if (data.id) {
      return this.prisma.message.upsert({
        where: { id: data.id, conversationId: data.conversationId },
        create: message, update: {},
      });
    }
    return this.prisma.message.create({ data: message });
  }

  getAgentContext(id: string) {
    return this.prisma.conversation.findUnique({ where: { id }, select: { agentContext: true } });
  }

  updateAgentContext(id: string, context: Prisma.InputJsonObject): Promise<Conversation> {
    return this.prisma.conversation.update({ where: { id }, data: { agentContext: context } });
  }

  async updateStatus(
    id: string,
    status: ConversationStatus
  ): Promise<Conversation> {
    return this.prisma.conversation.update({
      where: { id },
      data: { status },
    });
  }

  async updateIntent(
    id: string,
    intent: ConversationIntent | null
  ): Promise<Conversation> {
    return this.prisma.conversation.update({
      where: { id },
      data: { intent },
    });
  }

  async completeWithRecommendation(
    id: string,
    testId: string
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
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
