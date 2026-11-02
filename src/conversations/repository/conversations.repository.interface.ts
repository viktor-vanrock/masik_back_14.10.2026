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
import { BriefProgress, ConversationResponseState } from '../response-state';
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
  response?: { requestId: string; attempt: number; settle?: boolean };
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
  }>;

  abstract findArchived(page: number, userId: string): Promise<{
    data: Conversation[];
    total: number;
    pageSize: number;
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

  abstract isFrozen(id: string, userId: string): Promise<boolean>;

  abstract softDelete(id: string, userId: string): Promise<void>;

  abstract update(
    id: string,
    userId: string,
    data: { title?: string; isArchived?: boolean; pinnedDate?: Date | null },
  ): Promise<Conversation>;

  abstract createMessage(data: CreateMessageInput): Promise<(Message & { responseState?: ConversationResponseState | null }) | null>;

  abstract createUserResponse(data: CreateMessageInput & { id: string; userId: string }): Promise<{
    message: Message; responseState: ConversationResponseState; created: boolean;
  }>;

  abstract completeResponse(
    conversationId: string,
    requestId: string,
    attempt: number,
    status: 'responded' | 'failed',
    error?: ConversationResponseState['error'],
  ): Promise<ConversationResponseState | null>;

  abstract retryResponse(conversationId: string, userId: string, userMessageId: string, expectedAttempt: number): Promise<{
    responseState: ConversationResponseState; started: boolean;
  }>;

  abstract findResponseState(conversationId: string, requestId: string): Promise<ConversationResponseState | null>;

  abstract updateResponseProgress(conversationId: string, requestId: string, attempt: number,
    progress: Omit<BriefProgress, 'updatedAt'>): Promise<ConversationResponseState | null>;

  /** Service-token-only context access; public reads always require owner ID. */
  abstract getAgentContext(id: string): Promise<{
    agentContext: Prisma.JsonValue | null; executionMode: 'execute' | 'prepare_only';
  } | null>;
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
