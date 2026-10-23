import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { publishedCatalogEntryWhere } from '@/catalog/catalog-entry/catalog-entry.visibility';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateLeaderboardBoardDto } from './dto/create-leaderboard-board.dto';
import { UpdateLeaderboardBoardDto } from './dto/update-leaderboard-board.dto';

@Injectable()
export class LeaderboardBoardsService {
  constructor(private readonly prisma: PrismaService) {}

  listPublic() {
    return this.prisma.leaderboardBoard.findMany({ where: { isPublic: true }, orderBy: { createdAt: 'asc' } });
  }

  list(userId: string) {
    return this.prisma.leaderboardBoard.findMany({
      where: { OR: [{ isPublic: true }, { userId }] },
      orderBy: [{ isPublic: 'desc' }, { createdAt: 'asc' }],
    });
  }

  private name(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) {
      throw new BadRequestException('Board name must contain 1–80 characters after trimming');
    }
    return value.trim();
  }

  private description(value: unknown): string | null {
    if (value === undefined || null === value) return null;
    if (typeof value !== 'string' || value.length > 240) {
      throw new BadRequestException('Board description must be a string of at most 240 characters or null');
    }
    return value.trim() || null;
  }

  private async assertReferences(dto: UpdateLeaderboardBoardDto) {
    if (dto.modelIds?.length) {
      const models = await this.prisma.model.findMany({ where: { id: { in: dto.modelIds } }, select: { id: true } });
      const known = new Set(models.map(({ id }) => id));
      const missing = dto.modelIds.filter((id) => !known.has(id));
      if (missing.length) throw new BadRequestException(`Unknown model IDs: ${missing.join(', ')}`);
    }
    if (dto.benchmarkIds?.length) {
      const [tests, publishedEntries] = await Promise.all([
        this.prisma.catalogTestProjection.findMany({
          where: { testId: { in: dto.benchmarkIds }, deletedAt: null },
          select: { testId: true },
        }),
        this.prisma.catalogEntry.findMany({
          where: { testId: { in: dto.benchmarkIds }, ...publishedCatalogEntryWhere },
          select: { testId: true },
        }),
      ]);
      const publishedIds = new Set(publishedEntries.map(({ testId }) => testId));
      const allowedIds = new Set(tests.filter(({ testId }) => publishedIds.has(testId)).map(({ testId }) => testId));
      const rejected = dto.benchmarkIds.filter((id) => !allowedIds.has(id));
      if (rejected.length) throw new BadRequestException(`Unknown, deleted or unpublished Test IDs: ${rejected.join(', ')}`);
    }
  }

  async create(userId: string, dto: CreateLeaderboardBoardDto) {
    const name = this.name(dto.name);
    const description = this.description(dto.description);
    await this.assertReferences(dto);
    return this.prisma.leaderboardBoard.create({ data: {
      userId, name, description,
      modelIds: dto.modelIds ?? [],
      benchmarkIds: dto.benchmarkIds ?? [],
      architectures: dto.architectures ?? [],
    } });
  }
  async update(userId: string, id: string, dto: UpdateLeaderboardBoardDto) {
    const board = await this.prisma.leaderboardBoard.findFirst({ where: { id, userId } });
    if (!board) throw new NotFoundException('Leaderboard board was not found');
    const name = dto.name !== undefined ? this.name(dto.name) : undefined;
    const description = dto.description !== undefined ? this.description(dto.description) : undefined;
    await this.assertReferences(dto);
    return this.prisma.leaderboardBoard.update({ where: { id }, data: {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(dto.modelIds !== undefined ? { modelIds: dto.modelIds } : {}),
      ...(dto.benchmarkIds !== undefined ? { benchmarkIds: dto.benchmarkIds } : {}),
      ...(dto.architectures !== undefined ? { architectures: dto.architectures } : {}),
    } });
  }
  async remove(userId: string, id: string) {
    await this.update(userId, id, {});
    await this.prisma.leaderboardBoard.delete({ where: { id } });
  }
}
