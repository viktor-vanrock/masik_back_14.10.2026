import { randomUUID } from 'node:crypto';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ContactRequestsService, CONTACT_CONSENT_VERSION } from './contact-requests.service';
import { CreateContactRequestDto } from './dto/create-contact-request.dto';

const chatId = '11111111-1111-4111-8111-111111111111';
const input = { chatId, fullName: '  Иван Иванов  ', email: '  ivan@пример.рф  ', consent: true };

function storage(createRequest: jest.Mock, findChat = jest.fn().mockResolvedValue([{ id: chatId, role: 'DEMO', status: 'completed', agentContext: null }])) {
  const tx = { $queryRaw: findChat,
    contactRequest: { create: createRequest, findUnique: jest.fn().mockResolvedValue(null) } };
  return { contactRequest: tx.contactRequest,
    $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) } as unknown as PrismaService;
}

describe('contact requests', () => {
  it('records the updated legal text version for new requests', () => {
    expect(CONTACT_CONSENT_VERSION).toBe('aij-marketing-consent-2026-02');
  });

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
    const findChat = jest.fn().mockResolvedValue([{ id: chatId, role: 'DEMO', status: 'completed', agentContext: null }]);
    const createRequest = jest.fn().mockImplementation(async ({ data }) => ({ publicNumber: data.publicNumber }));
    const prisma = storage(createRequest, findChat);
    const service = new ContactRequestsService(prisma);
    const dto = plainToInstance(CreateContactRequestDto, input);
    const first = await service.create(dto, 'owner-id', randomUUID());
    const second = await service.create(dto, 'owner-id', randomUUID());

    expect(first.publicNumber).toMatch(/^AIJ-\d{4}-[A-F0-9]{24}$/);
    expect(second.publicNumber).not.toBe(first.publicNumber);
    expect(findChat.mock.calls[0].slice(1)).toEqual([chatId, 'owner-id', 'owner-id']);
    expect(createRequest).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        chatId, fullName: 'Иван Иванов', email: 'ivan@пример.рф', consent: true,
        consentVersion: CONTACT_CONSENT_VERSION,
      }),
    }));
    expect(createRequest.mock.calls[0][0].data).not.toHaveProperty('consentAt');
    expect(createRequest).toHaveBeenCalledTimes(2);
  });

  it('does not save contacts for an unknown or foreign chat', async () => {
    const createRequest = jest.fn();
    const prisma = storage(createRequest, jest.fn().mockResolvedValue([]));
    const service = new ContactRequestsService(prisma);
    await expect(service.create(plainToInstance(CreateContactRequestDto, input), 'owner-id', randomUUID()))
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
    const prisma = storage(createRequest);
    const service = new ContactRequestsService(prisma);
    await expect(service.create(plainToInstance(CreateContactRequestDto, input), 'owner-id', randomUUID()))
      .resolves.toEqual({ publicNumber: expect.stringMatching(/^AIJ-\d{4}-[A-F0-9]{24}$/) });
    expect(createRequest).toHaveBeenCalledTimes(2);
  });

  it('does not retry a unique conflict on another field', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('Duplicate request ID', {
      code: 'P2002', clientVersion: '7.8.0', meta: { target: ['id'] },
    });
    const createRequest = jest.fn().mockRejectedValue(conflict);
    const prisma = storage(createRequest);
    await expect(new ContactRequestsService(prisma).create(plainToInstance(CreateContactRequestDto, input), 'owner-id', randomUUID()))
      .rejects.toBe(conflict);
    expect(createRequest).toHaveBeenCalledTimes(1);
  });

  it('returns a controlled error after exhausting public-number retries', async () => {
    const collision = new Prisma.PrismaClientKnownRequestError('Duplicate public number', {
      code: 'P2002', clientVersion: '7.8.0', meta: { target: ['public_number'] },
    });
    const createRequest = jest.fn().mockRejectedValue(collision);
    const prisma = storage(createRequest);
    await expect(new ContactRequestsService(prisma).create(plainToInstance(CreateContactRequestDto, input), 'owner-id', randomUUID()))
      .rejects.toBeInstanceOf(InternalServerErrorException);
    expect(createRequest).toHaveBeenCalledTimes(3);
  });

  it('returns only the saved number for a matching operation and rejects a key collision with different data', async () => {
    const key = randomUUID();
    const create = jest.fn().mockImplementation(async ({ data }) => ({ publicNumber: data.publicNumber }));
    let saved: { publicNumber: string; requestHash: string } | null = null;
    const findUnique = jest.fn().mockImplementation(async () => saved);
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ id: chatId, role: 'DEMO', status: 'completed', agentContext: null }]),
      contactRequest: { create, findUnique } };
    create.mockImplementationOnce(async ({ data }) => {
      saved = { publicNumber: data.publicNumber, requestHash: data.requestHash };
      return { publicNumber: data.publicNumber };
    });
    const service = new ContactRequestsService({ contactRequest: tx.contactRequest,
      $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) } as unknown as PrismaService);
    const dto = plainToInstance(CreateContactRequestDto, input);
    const first = await service.create(dto, 'owner-id', key);
    expect(await service.create({ ...dto, fullName: ` ${dto.fullName} ` }, 'owner-id', key.toUpperCase())).toEqual(first);
    expect(create).toHaveBeenCalledTimes(1);
    await expect(service.create({ ...dto, email: 'different@example.test' }, 'owner-id', key)).rejects.toMatchObject({ status: 409 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({
      where: { requestOwnerId_idempotencyKey: { requestOwnerId: 'owner-id', idempotencyKey: key } },
      select: { publicNumber: true, requestHash: true },
    });
  });
});
