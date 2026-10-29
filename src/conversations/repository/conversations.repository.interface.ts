import { PaginationDto } from '@/common/dtos/paginationDto.dto';
import { InfiniteDataResponseType } from '@/common/types/infiniteDataResponse.type';
import {
  Conversation,
  ConversationIntent,
  ConversationStatus,
  Message,
  MessageKind,
  Prisma,
} from '@/generated/prisma/client';
import { ConversationWithMessages } from '../types';

export type CreateMessageInput = {
  id?: string;
  conversationId: string;
  role: 'agent' | 'user';
  kind: MessageKind;
  content: string;
  optionId?: string | null;
  options?: Prisma.InputJsonValue | null;
  interviewState?: Prisma.InputJsonValue | null;
};

export abstract class IConversationsRepository {
  abstract createConversation(userId: string): Promise<Conversation>;

  abstract findAll(
    query: PaginationDto,
    userId: string,
  ): Promise<InfiniteDataResponseType<Conversation>>;

  abstract findSidebar(page: number, userId: string): Promise<{
    pinned: Conversation[];
    data: Conversation[];
    total: number;
    pageSize: number;
    archived: Conversation[];
  }>;

  abstract findByIdWithMessages(
    id: string,
    userId: string,
  ): Promise<Nullable<ConversationWithMessages>>;

  abstract findById(
    id: string,
    userId: string,
  ): Promise<Nullable<Conversation>>;

  abstract findByIdUnsafe(id: string): Promise<Conversation | null>;

  abstract update(
    id: string,
    userId: string,
    data: { title?: string; isArchived?: boolean; pinnedDate?: Date | null },
  ): Promise<Conversation>;

  abstract createMessage(data: CreateMessageInput): Promise<Message>;

  /** Service-token-only context access; public reads always require owner ID. */
  abstract getAgentContext(id: string): Promise<{ agentContext: Prisma.JsonValue | null } | null>;
  abstract updateAgentContext(id: string, context: Prisma.InputJsonObject): Promise<Conversation>;

  abstract updateStatus(
    id: string,
    status: ConversationStatus,
  ): Promise<Conversation>;

  abstract updateIntent(
    id: string,
    intent: ConversationIntent | null,
  ): Promise<Conversation>;

  abstract completeWithRecommendation(
    id: string,
    testId: string,
  ): Promise<boolean>;

  abstract beginBenchmarkCreation(
    id: string,
    expectedIntent: ConversationIntent | null,
    rejectedTestId?: string,
  ): Promise<boolean>;
}
