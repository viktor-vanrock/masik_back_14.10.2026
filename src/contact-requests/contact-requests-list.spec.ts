import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ContactRequestsService } from './contact-requests.service';

describe('contact request listing', () => {
  const row = (id: string) => ({ id, publicNumber: `AIJ-${id}`, chatId: 'chat', fullName: 'Иван Иванов',
    email: 'ivan@example.com', consent: true, consentAt: new Date(), consentVersion: 'v1', createdAt: new Date(),
    materialSnapshot: { preparedBrief: { requirements: { goal: 'Проверить модель', task_count: '5' }, brief: { private: true } } },
    chat: { title: 'Тест', userId: 'demo-owner', isDeleted: false } });
  const prisma = { user: { findUnique: jest.fn() }, contactRequest: { findUnique: jest.fn(), findMany: jest.fn() } };
  const service = new ContactRequestsService(prisma as unknown as PrismaService);
  beforeEach(() => jest.resetAllMocks());

  it('checks the current database role before reading any contacts', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'DEMO' });
    await expect(service.list('demoted-user')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.contactRequest.findMany).not.toHaveBeenCalled();
  });

  it('allows an administrator to read contacts using the current database role', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
    prisma.contactRequest.findMany.mockResolvedValue([row('one')]);
    await expect(service.list('admin')).resolves.toMatchObject({ data: [{ publicNumber: 'AIJ-one' }] });
  });

  it('only links to a non-deleted conversation owned by the requesting administrator', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
    prisma.contactRequest.findMany.mockResolvedValue([
      { ...row('owned'), chat: { title: 'Owned', userId: 'admin', isDeleted: false } },
      { ...row('foreign'), chat: { title: 'Foreign', userId: 'demo-owner', isDeleted: false } },
      { ...row('deleted'), chat: { title: 'Deleted', userId: 'admin', isDeleted: true } },
    ]);
    const page = await service.list('admin');
    expect(page.data.map(({ chatAvailable }) => chatAvailable)).toEqual([true, false, false]);
  });

  it('returns at most 20 with a cursor and only required material', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'SUPERUSER' });
    prisma.contactRequest.findMany.mockResolvedValue(Array.from({ length: 21 }, (_, index) => row(String(index))));
    const page = await service.list('superuser');
    expect(page.data).toHaveLength(20);
    expect(page.nextCursor).toBe('19');
    expect(page.data[0]).toMatchObject({ requirements: { goal: 'Проверить модель', task_count: '5' }, chatAvailable: false });
    expect(page.data[0]).not.toHaveProperty('materialSnapshot');
    prisma.contactRequest.findUnique.mockResolvedValue({ id: '19' });
    prisma.contactRequest.findMany.mockResolvedValue([row('20')]);
    const next = await service.list('superuser', '19');
    expect(prisma.contactRequest.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: { id: '19' }, skip: 1, take: 21 }));
    expect(next.nextCursor).toBeNull();
    expect(next.data).toHaveLength(1);
  });

  it('rejects an invalid cursor', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'SUPERUSER' });
    prisma.contactRequest.findUnique.mockResolvedValue(null);
    await expect(service.list('superuser', 'missing')).rejects.toBeInstanceOf(BadRequestException);
  });
});
