import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService = new ConfigService()) {}

  async list(userId: string, cursor?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (user?.role !== 'SUPERUSER' && user?.role !== 'ADMIN') throw new ForbiddenException();

    const anchor = cursor ? await this.prisma.contactRequest.findUnique({
      where: { id: cursor }, select: { id: true },
    }) : null;
    if (cursor && !anchor) throw new BadRequestException('Invalid cursor');
    const rows = await this.prisma.contactRequest.findMany({
      ...(anchor ? { cursor: { id: anchor.id }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 21,
      select: { id: true, publicNumber: true, chatId: true, fullName: true, email: true,
        consent: true, consentAt: true, consentVersion: true, createdAt: true, materialSnapshot: true,
        chat: { select: { title: true, userId: true, isDeleted: true } } },
    });
    const page = rows.slice(0, 20);
    return {
      data: page.map(({ id, materialSnapshot, chat, ...item }) => {
        void id;
        const snapshot = materialSnapshot as Record<string, unknown> | null;
        const prepared = snapshot?.preparedBrief as Record<string, unknown> | undefined;
        const raw = prepared?.requirements;
        const requirements = raw && 'object' === typeof raw && !Array.isArray(raw)
          ? Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => 'string' === typeof entry[1]))
          : null;
        return { ...item, chatTitle: chat.title, chatAvailable: !chat.isDeleted && chat.userId === userId, requirements };
      }),
      nextCursor: rows.length > 20 ? page[page.length - 1].id : null,
    };
  }

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
          const mockReady = !prepared && 'completed' !== chat.status &&
            'mock' === this.config.get<string>('agent.mode') && 'dev' === this.config.get<string>('nodeEnv')
            ? await tx.message.findFirst({ where: { conversationId: chat.id, role: 'agent', kind: 'result',
              options: { path: ['resultKey'], equals: 'mock_draft_ready' } }, select: { id: true } }) : null;
          if (!prepared && !mockReady && 'completed' !== chat.status) throw new ConflictException('The request is not ready for contacts');
          const existing = await tx.contactRequest.findUnique({
            where: { requestOwnerId_idempotencyKey: { requestOwnerId: ownerId, idempotencyKey } },
            select: { publicNumber: true, requestHash: true },
          });
          if (existing) return this.replay(existing, requestHash);
          const context = chat.agentContext as Prisma.JsonObject | null;
          const materialSnapshot = prepared
            ? { kind: 'prepared_brief', revision: prepared.revision, preparedBrief: context!.prepared_brief! }
            : { kind: mockReady ? 'mock_draft' : 'completed_chat', conversationId: chat.id };
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
