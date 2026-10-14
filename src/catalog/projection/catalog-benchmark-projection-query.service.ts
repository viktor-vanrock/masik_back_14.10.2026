import { Injectable } from '@nestjs/common';
import { InfiniteDataResponseType } from '@/common/types/infiniteDataResponse.type';
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { BenchmarkQueryDto } from '../benchmark/dto/benchmarkQuery.dto';
import {
  BenchmarkOptionType,
  BenchmarkResponseType,
} from '../benchmark/types';

@Injectable()
export class CatalogBenchmarkProjectionQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: BenchmarkQueryDto
  ): Promise<InfiniteDataResponseType<BenchmarkResponseType>> {
    const where: Prisma.CatalogBenchmarkProjectionWhereInput = {
      ...this.activeWhere(),
      ...(query.search
        ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { nameEn: { contains: query.search, mode: 'insensitive' } },
          ],
        }
        : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.catalogBenchmarkProjection.findMany({
        where,
        orderBy: [{ sourceCreatedAt: 'desc' }, { benchmarkId: 'asc' }],
        skip,
        take: query.limit,
      }),
      this.prisma.catalogBenchmarkProjection.count({ where }),
    ]);

    return {
      data: await this.withTestCounts(rows),
      total,
    };
  }

  async findOptions(): Promise<BenchmarkOptionType[]> {
    const rows = await this.prisma.catalogBenchmarkProjection.findMany({
      where: this.activeWhere(),
      select: { benchmarkId: true, name: true, nameEn: true },
      orderBy: [{ name: 'asc' }, { benchmarkId: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.benchmarkId,
      name: row.name!,
      nameEn: row.nameEn!,
    }));
  }

  async findById(id: string): Promise<BenchmarkResponseType | null> {
    const row = await this.prisma.catalogBenchmarkProjection.findFirst({
      where: { benchmarkId: id, ...this.activeWhere() },
    });
    if (!row) return null;

    const [result] = await this.withTestCounts([row]);
    return result ?? null;
  }

  private async withTestCounts(
    rows: Array<{
      benchmarkId: string;
      name: string | null;
      nameEn: string | null;
      description: string | null;
      descriptionEn: string | null;
      sourceCreatedAt: Date | null;
      sourceUpdatedAt: Date;
    }>
  ): Promise<BenchmarkResponseType[]> {
    if (!rows.length) return [];

    const counts = await this.prisma.catalogTestProjection.groupBy({
      by: ['benchmarkId'],
      where: {
        benchmarkId: { in: rows.map(({ benchmarkId }) => benchmarkId) },
        deletedAt: null,
        snapshot: { not: Prisma.DbNull },
        name: { not: null },
        nameEn: { not: null },
        sourceCreatedAt: { not: null },
      },
      _count: { _all: true },
    });
    const countBySuite = new Map(
      counts.map((row) => [row.benchmarkId, row._count._all])
    );

    return rows.map((row) => ({
      id: row.benchmarkId,
      name: row.name!,
      nameEn: row.nameEn!,
      description: row.description,
      descriptionEn: row.descriptionEn,
      benchmarkTestsCount: countBySuite.get(row.benchmarkId) ?? 0,
      createdAt: row.sourceCreatedAt!.toISOString(),
      updatedAt: row.sourceUpdatedAt.toISOString(),
    }));
  }

  private activeWhere(): Prisma.CatalogBenchmarkProjectionWhereInput {
    return {
      deletedAt: null,
      name: { not: null },
      nameEn: { not: null },
      sourceCreatedAt: { not: null },
    };
  }
}
