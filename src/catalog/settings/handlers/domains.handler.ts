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
export class DomainsHandler extends IDictionaryHandler {
  private readonly logger = new Logger(DomainsHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly testUsage: CatalogTestUsageService
  ) {
    super();
  }

  async list(
    query: DictionaryListQueryDto
  ): Promise<InfiniteDataResponseType<DictionaryItemType>> {
    const where: Prisma.DictDomainWhereInput = { deletedAt: null };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { nameEn: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const skip = (query.page - 1) * query.limit;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.dictDomain.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take: query.limit,
      }),
      this.prisma.dictDomain.count({ where }),
    ]);

    const usageCounts = await this.batchCountUsage(rows.map((r) => r.id));
    const data = rows.map((row) =>
      mapDictionaryRow(row, null, usageCounts.get(row.id) ?? 0)
    );
    return { data, total };
  }

  async getOne(id: string): Promise<DictionaryItemType> {
    const row = await this.prisma.dictDomain.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) {
      throw new NotFoundException(`Domain "${id}" not found`);
    }
    return mapDictionaryRow(row, null, await this.countUsage(id));
  }

  async create(body: unknown): Promise<DictionaryItemType> {
    const dto = await validateDto(CreateDictionaryItemDto, body);
    const created = await withUniqueConflict(
      () =>
        this.prisma.dictDomain.create({
          data: {
            name: dto.name,
            nameEn: dto.nameEn,
            description: dto.description,
            descriptionEn: dto.descriptionEn,
          },
        }),
      'create domain'
    );
    this.logger.log(`Domain created: id="${created.id}"`);
    return mapDictionaryRow(created, null, 0);
  }

  async update(id: string, body: unknown): Promise<DictionaryItemType> {
    const dto = await validateDto(UpdateDictionaryItemDto, body);
    const existing = await this.prisma.dictDomain.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Domain "${id}" not found`);
    }
    const updated = await withUniqueConflict(
      () =>
        this.prisma.dictDomain.update({
          where: { id },
          data: {
            name: dto.name,
            nameEn: dto.nameEn,
            description: dto.description,
            descriptionEn: dto.descriptionEn,
          },
        }),
      'update domain'
    );
    this.logger.log(`Domain updated: id="${updated.id}"`);
    return mapDictionaryRow(updated, null, await this.countUsage(id));
  }

  async softDelete(id: string): Promise<void> {
    const existing = await this.prisma.dictDomain.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Domain "${id}" not found`);
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
    await this.prisma.dictDomain.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    this.logger.log(`Domain soft-deleted: id="${id}"`);
  }

  async countUsage(id: string): Promise<number> {
    const [tests, subdomains] = await Promise.all([
      this.testUsage.count('domainIds', id),
      this.prisma.dictSubdomain.count({
        where: { domainId: id, deletedAt: null },
      }),
    ]);
    return tests + subdomains;
  }

  private async batchCountUsage(ids: string[]): Promise<Map<string, number>> {
    const [testRows, subdomainRows] = await Promise.all([
      this.testUsage.countMany('domainIds', ids),
      this.prisma.dictSubdomain.groupBy({
        by: ['domainId'],
        where: { domainId: { in: ids }, deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    const counts = new Map(testRows);
    for (const r of subdomainRows) {
      counts.set(r.domainId, (counts.get(r.domainId) ?? 0) + r._count._all);
    }
    return counts;
  }
}
