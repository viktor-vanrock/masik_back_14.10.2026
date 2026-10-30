import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ContactRequestsService, CONTACT_CONSENT_VERSION } from './contact-requests.service';
import { CreateContactRequestDto } from './dto/create-contact-request.dto';

const chatId = '11111111-1111-4111-8111-111111111111';
const input = { chatId, fullName: '  Иван Иванов  ', email: '  ivan@пример.рф  ', consent: true };

describe('contact requests', () => {
  it('accepts Cyrillic domains and rejects invalid or missing consent', () => {
    expect(validateSync(plainToInstance(CreateContactRequestDto, input))).toHaveLength(0);
    expect(validateSync(plainToInstance(CreateContactRequestDto, { ...input, email: 'яиты@собака.рф' }))).toHaveLength(0);
    expect(validateSync(plainToInstance(CreateContactRequestDto, { ...input, consent: false }))).not.toHaveLength(0);
    expect(validateSync(plainToInstance(CreateContactRequestDto, { ...input, fullName: ' A ' }))).not.toHaveLength(0);
    expect(validateSync(plainToInstance(CreateContactRequestDto, { ...input, email: 'wrong' }))).not.toHaveLength(0);
    expect(validateSync(plainToInstance(CreateContactRequestDto, { ...input, email: 'user..bad@example.com' }))).not.toHaveLength(0);
    expect(validateSync(plainToInstance(CreateContactRequestDto, { ...input, email: 'user@-example.com' }))).not.toHaveLength(0);
    expect(validateSync(plainToInstance(CreateContactRequestDto, { ...input, chatId: 'not-a-uuid' }))).not.toHaveLength(0);
  });

  it('creates independent requests and checks that the caller owns the chat', async () => {
    const findChat = jest.fn().mockResolvedValue({ id: chatId });
    const createRequest = jest.fn().mockImplementation(async ({ data }) => ({ publicNumber: data.publicNumber }));
    const prisma = {
      conversation: { findFirst: findChat },
      contactRequest: { create: createRequest },
    } as unknown as PrismaService;
    const service = new ContactRequestsService(prisma);
    const dto = plainToInstance(CreateContactRequestDto, input);
    const first = await service.create(dto, 'owner-id');
    const second = await service.create(dto, 'owner-id');

    expect(first.publicNumber).toMatch(/^AIJ-\d{4}-[A-F0-9]{24}$/);
    expect(second.publicNumber).not.toBe(first.publicNumber);
    expect(findChat).toHaveBeenCalledWith({
      where: { id: chatId, userId: 'owner-id' }, select: { id: true },
    });
    expect(createRequest).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        chatId, fullName: 'Иван Иванов', email: 'ivan@пример.рф', consent: true,
        consentAt: expect.any(Date), consentVersion: CONTACT_CONSENT_VERSION,
      }),
    }));
    expect(createRequest).toHaveBeenCalledTimes(2);
  });

  it('does not save contacts for an unknown or foreign chat', async () => {
    const createRequest = jest.fn();
    const prisma = {
      conversation: { findFirst: jest.fn().mockResolvedValue(null) },
      contactRequest: { create: createRequest },
    } as unknown as PrismaService;
    const service = new ContactRequestsService(prisma);
    await expect(service.create(plainToInstance(CreateContactRequestDto, input), 'owner-id'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(createRequest).not.toHaveBeenCalled();
  });

  it('retries a rare public-number collision without deduplicating the contact', async () => {
    const collision = new Prisma.PrismaClientKnownRequestError('Duplicate public number', {
      code: 'P2002', clientVersion: '7.8.0', meta: { target: ['public_number'] },
    });
    const createRequest = jest.fn()
      .mockRejectedValueOnce(collision)
      .mockImplementationOnce(async ({ data }) => ({ publicNumber: data.publicNumber }));
    const prisma = {
      conversation: { findFirst: jest.fn().mockResolvedValue({ id: chatId }) },
      contactRequest: { create: createRequest },
    } as unknown as PrismaService;
    const service = new ContactRequestsService(prisma);
    await expect(service.create(plainToInstance(CreateContactRequestDto, input), 'owner-id'))
      .resolves.toEqual({ publicNumber: expect.stringMatching(/^AIJ-\d{4}-[A-F0-9]{24}$/) });
    expect(createRequest).toHaveBeenCalledTimes(2);
  });

  it('does not retry a unique conflict on another field', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('Duplicate request ID', {
      code: 'P2002', clientVersion: '7.8.0', meta: { target: ['id'] },
    });
    const createRequest = jest.fn().mockRejectedValue(conflict);
    const prisma = {
      conversation: { findFirst: jest.fn().mockResolvedValue({ id: chatId }) },
      contactRequest: { create: createRequest },
    } as unknown as PrismaService;
    await expect(new ContactRequestsService(prisma).create(plainToInstance(CreateContactRequestDto, input), 'owner-id'))
      .rejects.toBe(conflict);
    expect(createRequest).toHaveBeenCalledTimes(1);
  });
});
