import { createHash, randomBytes } from 'node:crypto';
import { ConflictException, ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { lockConversation } from '@/conversations/conversation-access';
import { presentDemoRequest } from '@/conversations/demo-request';
import { Prisma } from '@/generated/prisma/client';
import { stableStringify } from '@/generation/job-contract';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateContactRequestDto } from './dto/create-contact-request.dto';
import { contactIdempotencyKey } from './idempotency-key';

export const CONTACT_CONSENT_VERSION = 'aij-marketing-consent-2026-02';

@Injectable()
export class ContactRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateContactRequestDto, ownerId: string, key: string): Promise<{ publicNumber: string }> {
    const idempotencyKey = contactIdempotencyKey(key);
    const requestHash = createHash('sha256').update(stableStringify({
      chatId: input.chatId.toLowerCase(), fullName: input.fullName.trim(), email: input.email.trim(),
      consent: input.consent, consentVersion: CONTACT_CONSENT_VERSION,
    })).digest('hex');
    let attempts = 0;
    while (true) {
      const publicNumber = `AIJ-${new Date().getUTCFullYear()}-${randomBytes(12).toString('hex').toUpperCase()}`;
      try {
        return await this.prisma.$transaction(async (tx) => {
          const chat = await lockConversation(tx, input.chatId, ownerId);
          if ('DEMO' !== chat.role) throw new ForbiddenException('Contacts are available only for DEMO accounts');
          const prepared = presentDemoRequest(chat.agentContext);
          if (!prepared && 'completed' !== chat.status) throw new ConflictException('The request is not ready for contacts');
          const existing = await tx.contactRequest.findUnique({
            where: { requestOwnerId_idempotencyKey: { requestOwnerId: ownerId, idempotencyKey } },
            select: { publicNumber: true, requestHash: true },
          });
          if (existing) return this.replay(existing, requestHash);
          const context = chat.agentContext as Prisma.JsonObject | null;
          const materialSnapshot = prepared
            ? { kind: 'prepared_brief', revision: prepared.revision, preparedBrief: context!.prepared_brief! }
            : { kind: 'completed_chat', conversationId: chat.id };
          return tx.contactRequest.create({
            data: {
              publicNumber,
              chatId: chat.id,
              materialSnapshot,
              requestOwnerId: ownerId,
              idempotencyKey,
              requestHash,
              fullName: input.fullName.trim(),
              email: input.email.trim(),
              consent: true,
              consentVersion: CONTACT_CONSENT_VERSION,
            },
            select: { publicNumber: true },
          });
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && 'P2002' === error.code) {
          // A concurrent request for another chat can win the account/key constraint.
          const existing = await this.prisma.contactRequest.findUnique({
            where: { requestOwnerId_idempotencyKey: { requestOwnerId: ownerId, idempotencyKey } },
            select: { publicNumber: true, requestHash: true },
          });
          if (existing) return this.replay(existing, requestHash);
        }
        const target = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.target : undefined;
        const publicNumberConflict = error instanceof Prisma.PrismaClientKnownRequestError &&
          'P2002' === error.code &&
          (Array.isArray(target) ? target.includes('public_number') : 'contact_requests_public_number_key' === target);
        if (!publicNumberConflict) throw error;
        attempts += 1;
        if (3 === attempts) throw new InternalServerErrorException('Unable to allocate contact request number');
      }
    }
  }

  private replay(saved: { publicNumber: string; requestHash: string | null }, hash: string): { publicNumber: string } {
    if (saved.requestHash !== hash) throw new ConflictException('Idempotency key has already been used for a different request');
    return { publicNumber: saved.publicNumber };
  }
}
