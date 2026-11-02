import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateLeaderboardBoardDto } from './dto/create-leaderboard-board.dto';
import { UpdateLeaderboardBoardDto } from './dto/update-leaderboard-board.dto';
import { LeaderboardBoardsService } from './leaderboard-boards.service';

describe('Leaderboard board validation and persistence', () => {
  const create = jest.fn();
  const update = jest.fn();
  const findFirst = jest.fn();
  const findModels = jest.fn();
  const findTests = jest.fn();
  const findPublishedEntries = jest.fn();
  const prisma = {
    leaderboardBoard: { create, update, findFirst },
    model: { findMany: findModels },
    catalogTestProjection: { findMany: findTests },
    catalogEntry: { findMany: findPublishedEntries },
  } as unknown as PrismaService;
  const service = new LeaderboardBoardsService(prisma);
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const validateCreate = (value: unknown): Promise<CreateLeaderboardBoardDto> =>
    pipe.transform(value, { type: 'body', metatype: CreateLeaderboardBoardDto });
  const validatePatch = (value: unknown): Promise<UpdateLeaderboardBoardDto> =>
    pipe.transform(value, { type: 'body', metatype: UpdateLeaderboardBoardDto });

  beforeEach(() => {
    jest.clearAllMocks();
    findFirst.mockResolvedValue({ id: 'board', userId: 'owner' });
    findModels.mockResolvedValue([]);
    findTests.mockResolvedValue([]);
    findPublishedEntries.mockResolvedValue([]);
    create.mockImplementation(({ data }) => data);
    update.mockImplementation(({ data }) => data);
  });

  it.each([
    { name: '' },
    { name: '   ' },
    { name: 'x'.repeat(81) },
    { name: 'Board', architectures: ['unknown'] },
    { name: 'Board', architectures: ['text-diffusion', 'text-diffusion'] },
    { name: 'Board', modelIds: ['x'.repeat(161)] },
    { name: 'Board', benchmarkIds: ['x'.repeat(161)] },
    { name: 'Board', modelIds: Array.from({ length: 201 }, (_, i) => String(i)) },
    { name: 'Board', benchmarkIds: Array.from({ length: 501 }, (_, i) => String(i)) },
  ])('rejects invalid create payload with HTTP 400: %j', async (value) => {
    await expect(validateCreate(value)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['name', 'modelIds', 'benchmarkIds', 'architectures'])('rejects PATCH null for %s', async (field) => {
    await expect(validatePatch({ [field]: null })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clears description with PATCH null and preserves omitted fields', async () => {
    const dto = await validatePatch({ description: null });
    await expect(service.update('owner', 'board', dto)).resolves.toEqual({ description: null });
    expect(update).toHaveBeenCalledWith({ where: { id: 'board' }, data: { description: null } });
  });

  it('rejects null name even when called without the HTTP pipe', async () => {
    await expect(service.update('owner', 'board', { name: null } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects unknown model IDs on create and update', async () => {
    await expect(service.create('owner', { name: 'Board', modelIds: ['missing'] }))
      .rejects.toThrow('Unknown model IDs: missing');
    await expect(service.update('owner', 'board', { modelIds: ['missing'] }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects unknown or deleted Test IDs', async () => {
    await expect(service.create('owner', { name: 'Board', benchmarkIds: ['missing-test'] }))
      .rejects.toThrow('Unknown, deleted or unpublished Test IDs: missing-test');
    expect(findTests).toHaveBeenCalledWith({
      where: { testId: { in: ['missing-test'] }, deletedAt: null }, select: { testId: true },
    });
  });

  it('rejects unpublished and archived Tests even when their projections are active', async () => {
    findTests.mockResolvedValue([{ testId: 'published' }, { testId: 'draft' }, { testId: 'archived' }]);
    findPublishedEntries.mockResolvedValue([{ testId: 'published' }]);

    await expect(service.create('owner', { name: 'Board', benchmarkIds: ['published', 'draft', 'archived'] }))
      .rejects.toThrow('Unknown, deleted or unpublished Test IDs: draft, archived');
    expect(findPublishedEntries).toHaveBeenCalledWith({
      where: { testId: { in: ['published', 'draft', 'archived'] }, status: 'published', archivedAt: null },
      select: { testId: true },
    });
    expect(create).not.toHaveBeenCalled();

    await expect(service.update('owner', 'board', { benchmarkIds: ['draft'] }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('saves valid trimmed fields and existing references', async () => {
    findModels.mockResolvedValue([{ id: 'model' }]);
    findTests.mockResolvedValue([{ testId: 'test' }]);
    findPublishedEntries.mockResolvedValue([{ testId: 'test' }]);
    const dto = await validateCreate({
      name: ' Board ', description: ' Details ', modelIds: ['model'],
      benchmarkIds: ['test'], architectures: ['text-diffusion'],
    });
    await expect(service.create('owner', dto)).resolves.toMatchObject({
      name: 'Board', description: 'Details', modelIds: ['model'], benchmarkIds: ['test'],
    });
  });
});
