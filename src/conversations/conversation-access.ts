import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { presentDemoRequest } from './demo-request';

export type LockedConversation = {
  id: string; userId: string; role: string; status: string; agentContext: Prisma.JsonValue | null;
};

export async function lockConversation(db: Prisma.TransactionClient, id: string, userId?: string): Promise<LockedConversation> {
  const rows = await db.$queryRaw<LockedConversation[]>`
    SELECT c.id::text, c.user_id AS "userId", c.status, c.agent_context AS "agentContext", u.role
    FROM conversations c JOIN users u ON u.id::text = c.user_id
    WHERE c.id = CAST(${id} AS uuid) AND c.is_deleted = false
      AND (${userId ?? null}::text IS NULL OR c.user_id = ${userId ?? null})
    FOR UPDATE OF c, u
  `;
  if (!rows[0]) throw new NotFoundException('Conversation was not found');
  return rows[0];
}

export function isFrozenConversation(conversation: Pick<LockedConversation, 'role' | 'status' | 'agentContext'>): boolean {
  return 'DEMO' === conversation.role && ('completed' === conversation.status || presentDemoRequest(conversation.agentContext) !== null);
}

export function assertMutableConversation(conversation: LockedConversation): void {
  if (isFrozenConversation(conversation)) throw new ConflictException('Completed DEMO conversations are read-only');
}
