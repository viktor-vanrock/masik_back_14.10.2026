import { randomBytes } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateContactRequestDto } from './dto/create-contact-request.dto';

export const CONTACT_CONSENT_VERSION = 'aij-marketing-consent-2026-01';

@Injectable()
export class ContactRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateContactRequestDto, ownerId: string): Promise<{ publicNumber: string }> {
    const chat = await this.prisma.conversation.findFirst({
      where: { id: input.chatId, userId: ownerId },
      select: { id: true },
    });
    if (!chat) throw new NotFoundException('Chat not found');

    for (let attempt = 0; attempt < 3; attempt++) {
      const publicNumber = `AIJ-${new Date().getUTCFullYear()}-${randomBytes(12).toString('hex').toUpperCase()}`;
      try {
        const saved = await this.prisma.contactRequest.create({
          data: {
            publicNumber,
            chatId: chat.id,
            fullName: input.fullName.trim(),
            email: input.email.trim(),
            consent: true,
            consentAt: new Date(),
            consentVersion: CONTACT_CONSENT_VERSION,
          },
          select: { publicNumber: true },
        });
        return saved;
      } catch (error) {
        const target = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.target : undefined;
        const publicNumberConflict = error instanceof Prisma.PrismaClientKnownRequestError &&
          'P2002' === error.code &&
          (Array.isArray(target) ? target.includes('public_number') : 'contact_requests_public_number_key' === target);
        if (!publicNumberConflict || attempt >= 2) {
          throw error;
        }
      }
    }
    throw new Error('Unable to allocate contact request number');
  }
}
