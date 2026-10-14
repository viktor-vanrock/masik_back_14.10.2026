import { AgentMessageType } from '@/common/enums/agentMessageType.enum';
import { Prisma, Recommendation } from '@/generated/prisma/client';
import { HypothesisGenerationWithHypotheses } from '@/hypotheses/types';
import { RecommendationResultNotification } from '@/recommendations/types';

export const conversationFullInclude = {
  messages: {
    orderBy: {
      createdAt: 'asc',
    },
  },
  recommendations: {
    orderBy: {
      createdAt: 'asc',
    },
  },
  recommendationRequests: {
    orderBy: {
      createdAt: 'asc',
    },
    select: {
      id: true,
      conversationId: true,
      query: true,
      topK: true,
      status: true,
      attemptCount: true,
      maxAttempts: true,
      nextRetryAt: true,
      retrievalVersion: true,
      rerankerVersion: true,
      retrievalDurationMs: true,
      resultPayload: true,
      errorCode: true,
      errorMessage: true,
      retryable: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.ConversationInclude;

export type ConversationWithMessages = Prisma.ConversationGetPayload<{
  include: typeof conversationFullInclude;
}>;

export type AgentMessageOption = {
  id: string;
  label: string;
};

export type AgentQuestionContent = {
  kind: 'question';
  label: string;
  questionKey?: string;
  interviewState?: Record<string, string>;
  options?: AgentMessageOption[] | null;
};

export type AgentTextContent = { kind: 'text'; label: string };

export type AgentRecommendationsContent = {
  kind: 'recommendations';
  label: string;
  benchmarks: { testId: string; explanation?: string }[];
};

export type AgentResultContent = {
  kind: 'result';
  label: string;
  /**
   * Заполняется только если Interviewer действительно создал сущность в
   * Catalogue. Для текстового ТЗ/черновика фиктивный ID не нужен.
   */
  testId?: string;
  status: 'finished' | 'done' | 'generating';
  generationJobId?: string;
};

export type AgentHypothesesContent = {
  kind: 'hypotheses';
  hypotheses: string[];
  testId: string;
};

export type AgentMessagePayload = (
  | { type: AgentMessageType.Message; isFinal: false; content: AgentTextContent }
  | { type: AgentMessageType.Recommendations; isFinal: false; content: AgentRecommendationsContent }
  | { type: AgentMessageType.Question; isFinal: boolean; content: AgentQuestionContent }
  | { type: AgentMessageType.Result; isFinal: boolean; content: AgentResultContent }
  | { type: AgentMessageType.Hypotheses; isFinal: boolean; content: AgentHypothesesContent }
  | { type: AgentMessageType.Error; isFinal: true; content: { message: string } }
) & { eventId?: string };

export type UserMessageContent =
  | { kind: 'text'; label: string }
  | { kind: 'option'; id: string; label: string }
  | { kind: 'recommendation_selected'; testId: string }
  | { kind: 'recommendation_rejected'; testId: string };

export type HistoryEntry = (
  | { role: 'agent'; content: AgentQuestionContent | AgentResultContent | AgentTextContent | AgentRecommendationsContent }
  | { role: 'user'; content: UserMessageContent }
) & { id?: string };

export type AgentInitPayload = {
  type: 'init';
  conversationId?: string;
  intent: 'find_existing' | 'create_new' | null;
  history: HistoryEntry[];
};

export type AgentClientMessagePayload = {
  type: 'message';
  content: UserMessageContent;
};

export type AgentOutgoingPayload =
  | AgentInitPayload
  | AgentClientMessagePayload;

/** Сообщения агента, сохранённые в БД — id гарантирован. */
export type AgentSavedMessage = (
  | { type: AgentMessageType.Message; isFinal: false; content: AgentTextContent; id: string }
  | { type: AgentMessageType.Recommendations; isFinal: false; content: AgentRecommendationsContent; id: string;
    conversationId: string; recommendations: readonly Recommendation[] }
  | { type: AgentMessageType.Question; isFinal: boolean; content: AgentQuestionContent; id: string }
  | { type: AgentMessageType.Result; isFinal: boolean; content: AgentResultContent; id: string }
  | { type: AgentMessageType.Hypotheses; isFinal: boolean; content: AgentHypothesesContent; id: string }
) & { conversationId?: string };

/** Ошибка обработки — не сохраняется в БД, id отсутствует. */
export type AgentErrorMessage = { type: AgentMessageType.Error; isFinal: true; content: { message: string }; conversationId?: string };

/** Всё что приходит на фронт через agent_message событие. */
export type AgentMessageWithId = AgentSavedMessage | AgentErrorMessage;

export type AgentMessageHandler = (payload: AgentMessageWithId) => void;

export type HypothesesGeneratedHandler = (
  generation: HypothesisGenerationWithHypotheses
) => void;

export type StartChatParams = {
  conversationId?: string;
  userId: string;
  onAgent: AgentMessageHandler;
  onHypotheses?: HypothesesGeneratedHandler;
};

export type SendUserMessageParams = {
  userId: string;
  conversationId: string;
  kind: UserMessageContent['kind'];
  value: string;
  label?: string;
  onAgent: AgentMessageHandler;
  onHypotheses?: HypothesesGeneratedHandler;
};

export type RequestRecommendationsParams = {
  /**
   * Берём userId из проверенного JWT, а не из WebSocket body.
   */
  userId: string;

  conversationId: string;
  query: string;
};

export type StartBenchmarkCreationParams = {
  userId: string;
  conversationId: string;
  rejectedTestId?: string;
  onAgent: AgentMessageHandler;
  onHypotheses?: HypothesesGeneratedHandler;
};

export type ExecuteRecommendationRequestResult =
  RecommendationResultNotification;
