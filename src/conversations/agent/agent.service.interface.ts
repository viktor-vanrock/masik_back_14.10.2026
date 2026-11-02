import { AgentMessagePayload, AgentOutgoingPayload } from '../types';

export type AgentMessageCallback = (data: AgentMessagePayload) => void;


export abstract class IAgentService {
  abstract connect(conversationId: string): void;

  /** Replaces the current consumer for this conversation, if one exists. */
  abstract onMessage(
    conversationId: string,
    callback: AgentMessageCallback,
  ): void;

  abstract send(conversationId: string, data: AgentOutgoingPayload): void;

  abstract close(conversationId: string): void;
  acknowledgeMessage?: (conversationId: string, eventId: string) => void;
}
