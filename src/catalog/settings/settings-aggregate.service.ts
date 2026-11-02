import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { SettingsAggregateType } from './dictionary.types';

const aggregateSelect = {
  id: true,
  name: true,
  nameEn: true,
  description: true,
  descriptionEn: true,
} as const;

const subGroupSelect = {
  ...aggregateSelect,
  macroGroupId: true,
} as const;

const subdomainSelect = {
  ...aggregateSelect,
  domainId: true,
} as const;

const orderBy = [{ name: 'asc' as const }, { id: 'asc' as const }];

@Injectable()
export class SettingsAggregateService {
  private readonly logger = new Logger(SettingsAggregateService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<SettingsAggregateType> {
    this.logger.debug('Building settings aggregate');

    const [
      macroGroups,
      subGroups,
      abilityTaxons,
      taskTypes,
      modalities,
      languages,
      difficulties,
      capabilities,
      domains,
      subdomains,
    ] = await this.prisma.$transaction([
      this.prisma.dictMacroGroup.findMany({
        where: { deletedAt: null },
        select: aggregateSelect,
        orderBy,
      }),
      this.prisma.dictSubGroup.findMany({
        where: { deletedAt: null },
        select: subGroupSelect,
        orderBy,
      }),
      this.prisma.dictAbilityTaxon.findMany({
        where: { deletedAt: null },
        select: aggregateSelect,
        orderBy,
      }),
      this.prisma.dictTaskType.findMany({
        where: { deletedAt: null },
        select: aggregateSelect,
        orderBy,
      }),
      this.prisma.dictModality.findMany({
        where: { deletedAt: null },
        select: aggregateSelect,
        orderBy,
      }),
      this.prisma.dictLanguage.findMany({
        where: { deletedAt: null },
        select: aggregateSelect,
        orderBy,
      }),
      this.prisma.dictDifficulty.findMany({
        where: { deletedAt: null },
        select: aggregateSelect,
        orderBy,
      }),
      this.prisma.dictCapability.findMany({
        where: { deletedAt: null },
        select: aggregateSelect,
        orderBy,
      }),
      this.prisma.dictDomain.findMany({
        where: { deletedAt: null },
        select: aggregateSelect,
        orderBy,
      }),
      this.prisma.dictSubdomain.findMany({
        where: { deletedAt: null },
        select: subdomainSelect,
        orderBy,
      }),
    ]);

    return {
      taxonomy: {
        macroGroups,
        subGroups,
        abilityTaxons,
      },
      parameters: {
        taskTypes,
        modalities,
        languages,
        difficulties,
        capabilities,
      },
      domains: {
        domains,
        subdomains,
      },
    };
  }
}
