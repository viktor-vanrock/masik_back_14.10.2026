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
import { CreateSubdomainDto } from '../dto/createSubdomain.dto';
import { DictionaryListQueryDto } from '../dto/dictionaryListQuery.dto';
import { UpdateSubdomainDto } from '../dto/updateSubdomain.dto';
import { mapDictionaryRow, validateDto, withUniqueConflict } from '../settings.utils';
import { IDictionaryHandler } from './dictionary-handler.interface';

@Injectable()
export class SubdomainsHandler extends IDictionaryHandler {
  private readonly logger = new Logger(SubdomainsHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly testUsage: CatalogTestUsageService
  ) {
    super();
  }

  async list(
    query: DictionaryListQueryDto
  ): Promise<InfiniteDataResponseType<DictionaryItemType>> {
    const where: Prisma.DictSubdomainWhereInput = { deletedAt: null };
    if (query.parentId) {
      where.domainId = query.parentId;
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { nameEn: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const skip = (query.page - 1) * query.limit;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.dictSubdomain.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take: query.limit,
      }),
      this.prisma.dictSubdomain.count({ where }),
    ]);

    const usageCounts = await this.batchCountUsage(rows.map((r) => r.id));
    const data = rows.map((row) =>
      mapDictionaryRow(row, row.domainId, usageCounts.get(row.id) ?? 0)
    );
    return { data, total };
  }

  async getOne(id: string): Promise<DictionaryItemType> {
    const row = await this.prisma.dictSubdomain.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) {
      throw new NotFoundException(`Subdomain "${id}" not found`);
    }
    return mapDictionaryRow(row, row.domainId, await this.countUsage(id));
  }

  async create(body: unknown): Promise<DictionaryItemType> {
    const dto = await validateDto(CreateSubdomainDto, body);
    await this.assertParentExists(dto.domainId);
    const created = await withUniqueConflict(
      () =>
        this.prisma.dictSubdomain.create({
          data: {
            domainId: dto.domainId,
            name: dto.name,
            nameEn: dto.nameEn,
            description: dto.description,
            descriptionEn: dto.descriptionEn,
          },
        }),
      'create subdomain'
    );
    this.logger.log(`Subdomain created: id="${created.id}"`);
    return mapDictionaryRow(created, created.domainId, 0);
  }

  async update(id: string, body: unknown): Promise<DictionaryItemType> {
    const dto = await validateDto(UpdateSubdomainDto, body);
    const existing = await this.prisma.dictSubdomain.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Subdomain "${id}" not found`);
    }
    if (dto.domainId !== undefined) {
      await this.assertParentExists(dto.domainId);
    }
    const updated = await withUniqueConflict(
      () =>
        this.prisma.dictSubdomain.update({
          where: { id },
          data: {
            domainId: dto.domainId,
            name: dto.name,
            nameEn: dto.nameEn,
            description: dto.description,
            descriptionEn: dto.descriptionEn,
          },
        }),
      'update subdomain'
    );
    this.logger.log(`Subdomain updated: id="${updated.id}"`);
    return mapDictionaryRow(
      updated,
      updated.domainId,
      await this.countUsage(id)
    );
  }

  async softDelete(id: string): Promise<void> {
    const existing = await this.prisma.dictSubdomain.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Subdomain "${id}" not found`);
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
    await this.prisma.dictSubdomain.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    this.logger.log(`Subdomain soft-deleted: id="${id}"`);
  }

  async countUsage(id: string): Promise<number> {
    return this.testUsage.count('subdomainIds', id);
  }

  private async batchCountUsage(ids: string[]): Promise<Map<string, number>> {
    return this.testUsage.countMany('subdomainIds', ids);
  }

  private async assertParentExists(domainId: string): Promise<void> {
    const parent = await this.prisma.dictDomain.findFirst({
      where: { id: domainId, deletedAt: null },
      select: { id: true },
    });
    if (!parent) {
      throw new BadRequestException(
        `Parent domain "${domainId}" does not exist or is deleted`
      );
    }
  }
}
