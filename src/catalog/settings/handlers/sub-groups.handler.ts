import {
  BadRequestException,
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
import { CreateSubGroupDto } from '../dto/createSubGroup.dto';
import { DictionaryListQueryDto } from '../dto/dictionaryListQuery.dto';
import { UpdateSubGroupDto } from '../dto/updateSubGroup.dto';
import { mapDictionaryRow, validateDto, withUniqueConflict } from '../settings.utils';
import { IDictionaryHandler } from './dictionary-handler.interface';

@Injectable()
export class SubGroupsHandler extends IDictionaryHandler {
  private readonly logger = new Logger(SubGroupsHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly testUsage: CatalogTestUsageService
  ) {
    super();
  }

  async list(
    query: DictionaryListQueryDto
  ): Promise<InfiniteDataResponseType<DictionaryItemType>> {
    const where: Prisma.DictSubGroupWhereInput = { deletedAt: null };
    if (query.parentId) {
      where.macroGroupId = query.parentId;
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { nameEn: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const skip = (query.page - 1) * query.limit;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.dictSubGroup.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take: query.limit,
      }),
      this.prisma.dictSubGroup.count({ where }),
    ]);

    const usageCounts = await this.batchCountUsage(rows.map((r) => r.id));
    const data = rows.map((row) =>
      mapDictionaryRow(row, row.macroGroupId, usageCounts.get(row.id) ?? 0)
    );
    return { data, total };
  }

  async getOne(id: string): Promise<DictionaryItemType> {
    const row = await this.prisma.dictSubGroup.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) {
      throw new NotFoundException(`Sub-group "${id}" not found`);
    }
    return mapDictionaryRow(row, row.macroGroupId, await this.countUsage(id));
  }

  async create(body: unknown): Promise<DictionaryItemType> {
    const dto = await validateDto(CreateSubGroupDto, body);
    await this.assertParentExists(dto.macroGroupId);
    const created = await withUniqueConflict(
      () =>
        this.prisma.dictSubGroup.create({
          data: {
            macroGroupId: dto.macroGroupId,
            name: dto.name,
            nameEn: dto.nameEn,
            description: dto.description,
            descriptionEn: dto.descriptionEn,
          },
        }),
      'create sub-group'
    );
    this.logger.log(`Sub-group created: id="${created.id}"`);
    return mapDictionaryRow(created, created.macroGroupId, 0);
  }

  async update(id: string, body: unknown): Promise<DictionaryItemType> {
    const dto = await validateDto(UpdateSubGroupDto, body);
    const existing = await this.prisma.dictSubGroup.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Sub-group "${id}" not found`);
    }
    if (dto.macroGroupId !== undefined) {
      await this.assertParentExists(dto.macroGroupId);
    }
    const updated = await withUniqueConflict(
      () =>
        this.prisma.dictSubGroup.update({
          where: { id },
          data: {
            macroGroupId: dto.macroGroupId,
            name: dto.name,
            nameEn: dto.nameEn,
            description: dto.description,
            descriptionEn: dto.descriptionEn,
          },
        }),
      'update sub-group'
    );
    this.logger.log(`Sub-group updated: id="${updated.id}"`);
    return mapDictionaryRow(
      updated,
      updated.macroGroupId,
      await this.countUsage(id)
    );
  }

  async softDelete(id: string): Promise<void> {
    const existing = await this.prisma.dictSubGroup.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Sub-group "${id}" not found`);
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
    await this.prisma.dictSubGroup.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    this.logger.log(`Sub-group soft-deleted: id="${id}"`);
  }

  async countUsage(id: string): Promise<number> {
    return this.testUsage.count('subGroupIds', id);
  }

  private async batchCountUsage(ids: string[]): Promise<Map<string, number>> {
    return this.testUsage.countMany('subGroupIds', ids);
  }

  private async assertParentExists(macroGroupId: string): Promise<void> {
    const parent = await this.prisma.dictMacroGroup.findFirst({
      where: { id: macroGroupId, deletedAt: null },
      select: { id: true },
    });
    if (!parent) {
      throw new BadRequestException(
        `Parent macro-group "${macroGroupId}" does not exist or is deleted`
      );
    }
  }
}
