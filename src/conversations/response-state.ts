import type { Message, Prisma } from '@/generated/prisma/client';

export const BRIEF_STAGES = ['compose', 'validate', 'retry', 'save'] as const;
export type BriefProgress = { stage: typeof BRIEF_STAGES[number]; message: string; updatedAt: string };

export type ConversationResponseState = {
  requestId: string;
  userMessageId: string;
  status: 'pending' | 'responded' | 'failed';
  attempt: number;
  error: { code: string; message: string; retryable: boolean } | null;
  updatedAt: string;
  progress?: BriefProgress;
};

export function messageResponseState(message: Pick<Message, 'id' | 'role' | 'options'>): ConversationResponseState | null {
  if ('user' !== message.role || !message.options || 'object' !== typeof message.options || Array.isArray(message.options)) return null;
  const state = message.options.responseState;
  if (!state || 'object' !== typeof state || Array.isArray(state) ||
      'string' !== typeof state.status || !['pending', 'responded', 'failed'].includes(state.status) ||
      !Number.isInteger(state.attempt) || Number(state.attempt) < 1 || 'string' !== typeof state.updatedAt) return null;
  return { ...state, requestId: message.id, userMessageId: message.id } as ConversationResponseState;
}

export function latestResponseState(messages: Pick<Message, 'id' | 'role' | 'options'>[]): ConversationResponseState | null {
  const latestUser = messages.findLast((message) => 'user' === message.role);
  return latestUser ? messageResponseState(latestUser) : null;
}

export function responseOptions(state: ConversationResponseState): Prisma.InputJsonObject {
  return { responseState: state };
}
