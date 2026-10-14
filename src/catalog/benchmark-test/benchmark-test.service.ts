import { Injectable, NotFoundException } from '@nestjs/common';
import { BenchmarkCommandReceiptDto } from '@/benchmark-service/integration/benchmark-command-receipt.dto';
import { BenchmarkRemoteWriteService } from '@/benchmark-service/integration/benchmark-remote-write.service';
import { InfiniteDataResponseType } from '@/common/types/infiniteDataResponse.type';
import { BenchmarkValidationStatus } from '@/generated/prisma/client';
import { CatalogEntryCreateContext } from '../catalog-entry/catalog-entry-create-context';
import { CatalogTestProjectionQueryService } from '../projection/catalog-test-projection-query.service';
import { SettingsAggregateService } from '../settings/settings-aggregate.service';
import { BenchmarkTestReadScope } from './benchmark-test-read-scope';
import { BenchmarkTestQueryDto } from './dto/benchmarkTestQuery.dto';
import { CreateBenchmarkTestDto } from './dto/createBenchmarkTest.dto';
import { UpdateBenchmarkTestDto } from './dto/updateBenchmarkTest.dto';
import { BenchmarkTestFilterOptionsType, BenchmarkType } from './types';

@Injectable()
export class BenchmarkTestService {
  constructor(
    private readonly projectionQuery: CatalogTestProjectionQueryService,
    private readonly remoteWrites: BenchmarkRemoteWriteService,
    private readonly settingsAggregate: SettingsAggregateService
  ) {}

  findAllBenchmark(
    query: BenchmarkTestQueryDto
  ): Promise<InfiniteDataResponseType<BenchmarkType>> {
    return this.projectionQuery.findAll(query, BenchmarkTestReadScope.Public);
  }

  findAllForManagement(
    query: BenchmarkTestQueryDto
  ): Promise<InfiniteDataResponseType<BenchmarkType>> {
    return this.projectionQuery.findAll(query, BenchmarkTestReadScope.Management);
  }

  findPublishedBenchmarkById(id: string): Promise<BenchmarkType> {
    return this.findProjectionById(
      id,
      BenchmarkTestReadScope.Public
    );
  }

  findBenchmarkById(id: string): Promise<BenchmarkType> {
    return this.findProjectionById(
      id,
      BenchmarkTestReadScope.Management
    );
  }

  createBenchmark(
    dto: CreateBenchmarkTestDto,
    catalogEntry?: CatalogEntryCreateContext
  ): Promise<BenchmarkType | BenchmarkCommandReceiptDto> {
    const normalized = this.normalizeCreate(dto);
    return this.remoteWrites.createTest(normalized, catalogEntry);
  }

  createSubmission(
    dto: CreateBenchmarkTestDto,
    authorId: string,
    sourceConversationId?: string
  ): Promise<BenchmarkType | BenchmarkCommandReceiptDto> {
    return this.createBenchmark(dto, {
      status: BenchmarkValidationStatus.validation,
      authorId,
      sourceConversationId,
    });
  }

  updateBenchmarkById(
    id: string,
    dto: UpdateBenchmarkTestDto
  ): Promise<BenchmarkType | BenchmarkCommandReceiptDto> {
    const normalized = this.normalizeUpdate(dto);
    return this.remoteWrites.updateTest(id, normalized);
  }

  restoreBenchmarkById(
    id: string
  ): Promise<BenchmarkType | BenchmarkCommandReceiptDto> {
    return this.remoteWrites.restoreTest(id);
  }

  softDeleteBenchmarkById(
    id: string
  ): Promise<void | BenchmarkCommandReceiptDto> {
    return this.remoteWrites.deleteTest(id);
  }

  async getFilterOptions(): Promise<BenchmarkTestFilterOptionsType> {
    const [settings, strings] = await Promise.all([
      this.settingsAggregate.getAll(),
      this.projectionQuery.getPublishedStringFilterOptions(),
    ]);
    return {
      macroGroups: settings.taxonomy.macroGroups,
      subGroups: settings.taxonomy.subGroups.map(
        ({ id, name, nameEn, macroGroupId }) => ({
          id,
          name,
          nameEn,
          macroGroupId: macroGroupId!,
        })
      ),
      abilityTaxons: settings.taxonomy.abilityTaxons,
      taskTypes: settings.parameters.taskTypes,
      modalities: settings.parameters.modalities,
      languages: settings.parameters.languages,
      difficulties: settings.parameters.difficulties,
      capabilities: settings.parameters.capabilities,
      domains: settings.domains.domains,
      subdomains: settings.domains.subdomains.map(
        ({ id, name, nameEn, domainId }) => ({
          id,
          name,
          nameEn,
          domainId: domainId!,
        })
      ),
      ...strings,
    };
  }

  private async findProjectionById(
    id: string,
    scope: BenchmarkTestReadScope
  ): Promise<BenchmarkType> {
    const test = await this.projectionQuery.findById(id, scope);
    if (!test) {
      throw new NotFoundException(`Benchmark with id "${id}" was not found`);
    }
    return test;
  }

  private normalizeCreate(dto: CreateBenchmarkTestDto): CreateBenchmarkTestDto {
    return {
      ...dto,
      ...this.dedupTopLevelIds(dto),
      datasetSubsamples: dto.datasetSubsamples,
    };
  }

  private normalizeUpdate(dto: UpdateBenchmarkTestDto): UpdateBenchmarkTestDto {
    return {
      ...dto,
      ...this.dedupTopLevelIds(dto),
      datasetSubsamples: dto.datasetSubsamples,
    };
  }

  private dedupTopLevelIds(
    dto: CreateBenchmarkTestDto | UpdateBenchmarkTestDto
  ): Partial<CreateBenchmarkTestDto> {
    return {
      skills: this.unique(dto.skills),
      abilityTags: this.unique(dto.abilityTags),
      metrics: this.unique(
        dto.metrics
          ?.map((metric) => metric.trim())
          .filter((metric) => 0 < metric.length)
      ),
      subGroupIds: this.unique(dto.subGroupIds),
      abilityTaxonIds: this.unique(dto.abilityTaxonIds),
      domainIds: this.unique(dto.domainIds),
      subdomainIds: this.unique(dto.subdomainIds),
      modalityIds: this.unique(dto.modalityIds),
      capabilityIds: this.unique(dto.capabilityIds),
    };
  }

  private unique(ids: string[] | undefined): string[] | undefined {
    return ids === undefined ? undefined : [...new Set(ids)];
  }

}
