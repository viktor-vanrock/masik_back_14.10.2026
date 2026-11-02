import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InfiniteDataResponseType } from '@/common/types/infiniteDataResponse.type';
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CatalogTestUsageService } from '../catalog-test-usage.service';
import { DictionaryItemType } from '../dictionary.types';
import { CreateDictionaryItemDto } from '../dto/createDictionaryItem.dto';
import { DictionaryListQueryDto } from '../dto/dictionaryListQuery.dto';
import { UpdateDictionaryItemDto } from '../dto/updateDictionaryItem.dto';
import { mapDictionaryRow, validateDto, withUniqueConflict } from '../settings.utils';
import { IDictionaryHandler } from './dictionary-handler.interface';

@Injectable()
export class MacroGroupsHandler extends IDictionaryHandler {
  private readonly logger = new Logger(MacroGroupsHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly testUsage: CatalogTestUsageService
  ) {
    super();
  }

  async list(
    query: DictionaryListQueryDto
  ): Promise<InfiniteDataResponseType<DictionaryItemType>> {
    const where: Prisma.DictMacroGroupWhereInput = { deletedAt: null };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { nameEn: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const skip = (query.page - 1) * query.limit;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.dictMacroGroup.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take: query.limit,
      }),
      this.prisma.dictMacroGroup.count({ where }),
    ]);

    const usageCounts = await this.batchCountUsage(rows.map((r) => r.id));
    const data = rows.map((row) =>
      mapDictionaryRow(row, null, usageCounts.get(row.id) ?? 0)
    );
    return { data, total };
  }

  async getOne(id: string): Promise<DictionaryItemType> {
    const row = await this.prisma.dictMacroGroup.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) {
      throw new NotFoundException(`Macro group "${id}" not found`);
    }
    return mapDictionaryRow(row, null, await this.countUsage(id));
  }

  async create(body: unknown): Promise<DictionaryItemType> {
    const dto = await validateDto(CreateDictionaryItemDto, body);
    const created = await withUniqueConflict(
      () =>
        this.prisma.dictMacroGroup.create({
          data: {
            name: dto.name,
            nameEn: dto.nameEn,
            description: dto.description,
            descriptionEn: dto.descriptionEn,
          },
        }),
      'create macro-group'
    );
    this.logger.log(`Macro group created: id="${created.id}"`);
    return mapDictionaryRow(created, null, 0);
  }

  async update(id: string, body: unknown): Promise<DictionaryItemType> {
    const dto = await validateDto(UpdateDictionaryItemDto, body);
    const existing = await this.prisma.dictMacroGroup.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Macro group "${id}" not found`);
    }
    const updated = await withUniqueConflict(
      () =>
        this.prisma.dictMacroGroup.update({
          where: { id },
          data: {
            name: dto.name,
            nameEn: dto.nameEn,
            description: dto.description,
            descriptionEn: dto.descriptionEn,
          },
        }),
      'update macro-group'
    );
    this.logger.log(`Macro group updated: id="${updated.id}"`);
    return mapDictionaryRow(updated, null, await this.countUsage(id));
  }

  async softDelete(id: string): Promise<void> {
    const existing = await this.prisma.dictMacroGroup.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Macro group "${id}" not found`);
    }
    const usageCount = await this.countUsage(id);
    if (usageCount > 0) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'Dictionary entry is in use',
        usageCount,
      });
    }
    await this.prisma.dictMacroGroup.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    this.logger.log(`Macro group soft-deleted: id="${id}"`);
  }

  async countUsage(id: string): Promise<number> {
    const [tests, subGroups] = await Promise.all([
      this.testUsage.count('macroGroupId', id),
      this.prisma.dictSubGroup.count({
        where: { macroGroupId: id, deletedAt: null },
      }),
    ]);
    return tests + subGroups;
  }

  private async batchCountUsage(ids: string[]): Promise<Map<string, number>> {
    const [testRows, subGroupRows] = await Promise.all([
      this.testUsage.countMany('macroGroupId', ids),
      this.prisma.dictSubGroup.groupBy({
        by: ['macroGroupId'],
        where: { macroGroupId: { in: ids }, deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    const counts = new Map(testRows);
    for (const r of subGroupRows) {
      counts.set(r.macroGroupId, (counts.get(r.macroGroupId) ?? 0) + r._count._all);
    }
    return counts;
  }
}
