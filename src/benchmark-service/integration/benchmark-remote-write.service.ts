import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BenchmarkTestSpecificationV1,
  DatasetSubsampleV1,
  parseBenchmarkTestSnapshotV1,
} from '@/benchmark-service/contracts/benchmark-integration.v1';
import { CreateBenchmarkDto } from '@/catalog/benchmark/dto/createBenchmark.dto';
import { UpdateBenchmarkDto } from '@/catalog/benchmark/dto/updateBenchmark.dto';
import { DictionaryValidator } from '@/catalog/benchmark-test/dictionary-validator';
import {
  CreateBenchmarkTestDto,
  CreateDatasetSubsampleDto,
} from '@/catalog/benchmark-test/dto/createBenchmarkTest.dto';
import { UpdateBenchmarkTestDto } from '@/catalog/benchmark-test/dto/updateBenchmarkTest.dto';
import { CatalogEntryCreateContext } from '@/catalog/catalog-entry/catalog-entry-create-context';
import {
  BenchmarkValidationStatus,
  Prisma,
} from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { BenchmarkCommandOutboxService } from './benchmark-command-outbox.service';
import { BenchmarkCommandReceiptDto } from './benchmark-command-receipt.dto';

@Injectable()
export class BenchmarkRemoteWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commands: BenchmarkCommandOutboxService,
    private readonly dictionaryValidator: DictionaryValidator
  ) {}

  async createSuite(
    dto: CreateBenchmarkDto
  ): Promise<BenchmarkCommandReceiptDto> {
    const benchmarkId = randomUUID();
    const operationId = await this.prisma.$transaction((tx) =>
      this.commands.requestSuiteCreate(tx, benchmarkId, {
        name: dto.name,
        nameEn: dto.nameEn,
        description: dto.description ?? null,
        descriptionEn: dto.descriptionEn ?? null,
      })
    );
    return this.receipt(operationId, benchmarkId);
  }

  async updateSuite(
    benchmarkId: string,
    dto: UpdateBenchmarkDto
  ): Promise<BenchmarkCommandReceiptDto> {
    benchmarkId = benchmarkId.toLowerCase();
    const current = await this.activeSuite(benchmarkId);
    const operationId = await this.prisma.$transaction((tx) =>
      this.commands.requestSuiteUpdate(
        tx,
        benchmarkId,
        current.aggregateVersion,
        {
          name: dto.name ?? current.name!,
          nameEn: dto.nameEn ?? current.nameEn!,
          description:
            dto.description === undefined
              ? current.description
              : dto.description ?? null,
          descriptionEn:
            dto.descriptionEn === undefined
              ? current.descriptionEn
              : dto.descriptionEn ?? null,
        }
      )
    );
    return this.receipt(operationId, benchmarkId);
  }

  async deleteSuite(
    benchmarkId: string
  ): Promise<BenchmarkCommandReceiptDto> {
    benchmarkId = benchmarkId.toLowerCase();
    const current = await this.activeSuite(benchmarkId);
    const activeTests = await this.prisma.catalogTestProjection.count({
      where: {
        benchmarkId,
        deletedAt: null,
        snapshot: { not: Prisma.DbNull },
      },
    });
    if (activeTests > 0) {
      throw new ConflictException(
        `Benchmark suite "${benchmarkId}" has ${activeTests} active benchmark tests. Reassign or delete them first.`
      );
    }
    const operationId = await this.prisma.$transaction((tx) =>
      this.commands.requestSuiteDelete(
        tx,
        benchmarkId,
        current.aggregateVersion
      )
    );
    return this.receipt(operationId, benchmarkId);
  }

  async restoreSuite(
    benchmarkId: string
  ): Promise<BenchmarkCommandReceiptDto> {
    benchmarkId = benchmarkId.toLowerCase();
    const current = await this.completeSuite(benchmarkId);
    const operationId = await this.prisma.$transaction((tx) =>
      this.commands.requestSuiteRestore(
        tx,
        benchmarkId,
        current.aggregateVersion
      )
    );
    return this.receipt(operationId, benchmarkId);
  }

  async createTest(
    dto: CreateBenchmarkTestDto,
    catalogEntry: CatalogEntryCreateContext = {
      status: BenchmarkValidationStatus.validation,
    }
  ): Promise<BenchmarkCommandReceiptDto> {
    const testId = randomUUID();
    const operationId = await this.prisma.$transaction(async (tx) => {
      await this.assertActiveSuite(tx, dto.suiteId);
      await this.dictionaryValidator.validate(tx, dto);
      const specification = await this.testSpecification(tx, dto);
      await tx.catalogEntry.create({
        data: {
          testId,
          status: catalogEntry.status,
          authorId: catalogEntry.authorId,
          sourceConversationId: catalogEntry.sourceConversationId,
        },
      });
      const operationId = await this.commands.requestTestCreate(
        tx,
        testId,
        specification
      );
      await this.grantOperationAccess(
        tx,
        operationId,
        catalogEntry.authorId
      );
      return operationId;
    });
    return this.receipt(operationId, testId, 'test');
  }

  async updateTest(
    testId: string,
    dto: UpdateBenchmarkTestDto
  ): Promise<BenchmarkCommandReceiptDto> {
    testId = testId.toLowerCase();
    const current = await this.activeTest(testId);

    const operationId = await this.prisma.$transaction(async (tx) => {
      await this.commands.lockTestWrites(tx, testId);
      await this.assertMutable(tx, current, testId);
      const specification = await this.testSpecification(
        tx,
        dto,
        current.specification
      );
      await this.assertActiveSuite(tx, specification.suiteId);
      await this.dictionaryValidator.validate(
        tx,
        this.dictionaryValidationPayload(specification)
      );
      const entry = await tx.catalogEntry.findUnique({
        where: { testId },
        select: { status: true },
      });
      if (
        BenchmarkValidationStatus.published === entry?.status &&
        0 === specification.metricIds.length
      ) {
        throw new BadRequestException(
          'A published Test must keep at least one assigned Metric'
        );
      }
      return this.commands.requestTestUpdate(
        tx,
        testId,
        current.aggregateVersion,
        specification
      );
    });
    return this.receipt(operationId, testId, 'test');
  }

  async deleteTest(testId: string): Promise<BenchmarkCommandReceiptDto> {
    testId = testId.toLowerCase();
    const current = await this.activeTest(testId);
    const operationId = await this.prisma.$transaction(async (tx) => {
      await this.commands.lockTestWrites(tx, testId);
      await this.assertMutable(tx, current, testId);
      return this.commands.requestTestDelete(tx, testId, current.aggregateVersion);
    });
    return this.receipt(operationId, testId, 'test');
  }

  async restoreTest(
    testId: string,
    resetSubmission = false,
    requestedById?: string
  ): Promise<BenchmarkCommandReceiptDto> {
    testId = testId.toLowerCase();
    const current = await this.completeTest(testId);
    await this.prisma.$transaction(async (tx) => {
      await this.assertActiveSuite(tx, current.specification.suiteId);
    });
    const operationId = await this.prisma.$transaction(async (tx) => {
      const operationId = await this.commands.requestTestRestore(
        tx,
        testId,
        current.aggregateVersion
      );
      await this.grantOperationAccess(
        tx,
        operationId,
        requestedById,
        resetSubmission && Boolean(current.deletedAt)
      );
      return operationId;
    });
    return this.receipt(operationId, testId, 'test');
  }

  private async activeSuite(benchmarkId: string) {
    const suite = await this.completeSuite(benchmarkId);
    if (suite.deletedAt) {
      throw new NotFoundException(
        `Benchmark suite with id "${benchmarkId}" was not found`
      );
    }
    return suite;
  }

  private async completeSuite(benchmarkId: string) {
    const suite = await this.prisma.catalogBenchmarkProjection.findUnique({
      where: { benchmarkId },
    });
    if (!suite || !suite.name || !suite.nameEn || !suite.sourceCreatedAt) {
      throw new NotFoundException(
        `Benchmark suite with id "${benchmarkId}" was not found`
      );
    }
    return suite;
  }

  private async activeTest(testId: string) {
    const test = await this.completeTest(testId);
    if (test.deletedAt) {
      throw new NotFoundException(`Benchmark with id "${testId}" was not found`);
    }
    return test;
  }

  private async completeTest(testId: string) {
    const projection = await this.prisma.catalogTestProjection.findUnique({
      where: { testId },
      select: { snapshot: true, aggregateVersion: true, deletedAt: true },
    });
    if (!projection?.snapshot) {
      throw new NotFoundException(`Benchmark with id "${testId}" was not found`);
    }
    const snapshot = parseBenchmarkTestSnapshotV1(projection.snapshot);
    return {
      ...snapshot,
      aggregateVersion: projection.aggregateVersion,
      deletedAt: projection.deletedAt,
    };
  }

  private async assertMutable(
    tx: Prisma.TransactionClient,
    test: { specificationLockedAt: string | null },
    testId: string
  ): Promise<void> {
    const result = await tx.metricResult.findFirst({
      where: { testId },
      select: { id: true },
    });
    if (test.specificationLockedAt || result) {
      throw new ConflictException(
        `A Test with MetricResult records cannot be changed until Test versioning is implemented: "${testId}"`
      );
    }
  }

  private async assertActiveSuite(
    tx: Prisma.TransactionClient,
    suiteId: string
  ): Promise<void> {
    const suite = await tx.catalogBenchmarkProjection.findFirst({
      where: {
        benchmarkId: suiteId,
        deletedAt: null,
        name: { not: null },
        nameEn: { not: null },
        sourceCreatedAt: { not: null },
      },
      select: { benchmarkId: true },
    });
    if (!suite) {
      throw new BadRequestException(
        `Benchmark suite with id "${suiteId}" was not found`
      );
    }
  }

  private async testSpecification(
    tx: Prisma.TransactionClient,
    dto: CreateBenchmarkTestDto | UpdateBenchmarkTestDto,
    current?: BenchmarkTestSpecificationV1
  ): Promise<BenchmarkTestSpecificationV1> {
    const metricIds =
      dto.metrics === undefined && current
        ? [...current.metricIds]
        : await this.resolveMetricIds(tx, dto.metrics ?? []);
    const datasetSubsamples =
      dto.datasetSubsamples === undefined && current
        ? current.datasetSubsamples.map((item) => ({ ...item }))
        : this.datasetSubsamples(dto.datasetSubsamples ?? [], current);
    const zero = { min: 0, median: 0, max: 0 };
    const value = <T>(next: T | undefined, previous: T): T =>
      next === undefined ? previous : next;

    return {
      suiteId: value(dto.suiteId, current?.suiteId ?? ''),
      name: value(dto.name, current?.name ?? ''),
      nameEn: value(dto.nameEn, current?.nameEn ?? ''),
      description: value(dto.description, current?.description ?? ''),
      descriptionEn: value(dto.descriptionEn, current?.descriptionEn),
      shortDescription: value(dto.shortDescription, current?.shortDescription),
      taskDescription: value(dto.taskDescription, current?.taskDescription),
      instructions: value(dto.instructions, current?.instructions),
      instructionsEn: value(dto.instructionsEn, current?.instructionsEn),
      codebase: value(dto.codebase, current?.codebase ?? null),
      macroGroupId: value(dto.macroGroupId, current?.macroGroupId ?? null),
      subGroupIds: value(dto.subGroupIds, [...(current?.subGroupIds ?? [])]),
      abilityTaxonIds: value(
        dto.abilityTaxonIds,
        [...(current?.abilityTaxonIds ?? [])]
      ),
      taskTypeId: value(dto.taskTypeId, current?.taskTypeId ?? null),
      modalityIds: value(dto.modalityIds, [...(current?.modalityIds ?? [])]),
      languageId: value(dto.languageId, current?.languageId ?? null),
      difficultyId: value(dto.difficultyId, current?.difficultyId ?? null),
      capabilityIds: value(
        dto.capabilityIds,
        [...(current?.capabilityIds ?? [])]
      ),
      domainIds: value(dto.domainIds, [...(current?.domainIds ?? [])]),
      subdomainIds: value(
        dto.subdomainIds,
        [...(current?.subdomainIds ?? [])]
      ),
      abilityTags: value(dto.abilityTags, [...(current?.abilityTags ?? [])]),
      skills: value(dto.skills, [...(current?.skills ?? [])]),
      metricIds,
      examples: value(dto.examples, [...(current?.examples ?? [])]).map(
        (example) => ({ ...example })
      ),
      datasetSubsamples,
      references: value(
        dto.references,
        [...(current?.references ?? [])]
      ).map((reference) => ({ ...reference })),
      links: value(dto.links, [...(current?.links ?? [])]).map((link) => ({
        ...link,
      })),
      sizeInSamples: value(dto.sizeInSamples, current?.sizeInSamples ?? 0),
      medianSampleSizeWords: value(
        dto.medianSampleSizeWords,
        current?.medianSampleSizeWords ?? 0
      ),
      requestLengthDist: {
        ...value(dto.requestLengthDist, current?.requestLengthDist ?? zero),
      },
      responseLengthDist: {
        ...value(dto.responseLengthDist, current?.responseLengthDist ?? zero),
      },
      isDifficultyAutoCalculated: value(
        dto.isDifficultyAutoCalculated,
        current?.isDifficultyAutoCalculated ?? false
      ),
      difficultyCalculationComment: value(
        dto.difficultyCalculationComment,
        current?.difficultyCalculationComment
      ),
      confidenceScore: value(dto.confidenceScore, current?.confidenceScore),
      confidentialityLevel: value(
        dto.confidentialityLevel,
        current?.confidentialityLevel
      ),
      knowledgeLevel: value(dto.knowledgeLevel, current?.knowledgeLevel),
      importance: value(dto.importance, current?.importance),
      importanceComment: value(
        dto.importanceComment,
        current?.importanceComment
      ),
      contextFieldFormat: value(
        dto.contextFieldFormat,
        current?.contextFieldFormat
      ),
      answerFieldFormat: value(
        dto.answerFieldFormat,
        current?.answerFieldFormat
      ),
      evaluationLogic: value(dto.evaluationLogic, current?.evaluationLogic),
      humanBaseline: value(dto.humanBaseline, current?.humanBaseline),
      humanBaselineNotes: value(
        dto.humanBaselineNotes,
        current?.humanBaselineNotes
      ),
      recommendedMetricsDescription: value(
        dto.recommendedMetricsDescription,
        current?.recommendedMetricsDescription
      ),
      requiredGigaChatQualityLevel: value(
        dto.requiredGigaChatQualityLevel,
        current?.requiredGigaChatQualityLevel
      ),
      gigaMetricAdapterName: value(
        dto.gigaMetricAdapterName,
        current?.gigaMetricAdapterName
      ),
      gigaMetricSetUrl: value(dto.gigaMetricSetUrl, current?.gigaMetricSetUrl),
      gigaMetricLaunchCommand: value(
        dto.gigaMetricLaunchCommand,
        current?.gigaMetricLaunchCommand
      ),
      gigaMetricsCodebaseUrl: value(
        dto.gigaMetricsCodebaseUrl,
        current?.gigaMetricsCodebaseUrl
      ),
      isGenerated: value(dto.isGenerated, current?.isGenerated ?? false),
      jiraTicketId: value(dto.jiraTicketId, current?.jiraTicketId),
      generatedAt: current?.generatedAt,
    };
  }

  private datasetSubsamples(
    values: CreateDatasetSubsampleDto[],
    current?: BenchmarkTestSpecificationV1
  ): DatasetSubsampleV1[] {
    const existingIds = new Set(
      current?.datasetSubsamples.map(({ id }) => id.toLowerCase()) ?? []
    );
    const requestedIds = values
      .map(({ id }) => id?.toLowerCase())
      .filter((id): id is string => id !== undefined);
    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new BadRequestException(
        'DatasetSubsample ids must be unique within one Test update'
      );
    }
    if (current) {
      const foreignId = requestedIds.find((id) => !existingIds.has(id));
      if (foreignId) {
        throw new BadRequestException(
          `DatasetSubsample "${foreignId}" does not belong to this Test`
        );
      }
    }
    return values.map((item) => this.datasetSubsample(item, current ? item.id?.toLowerCase() : undefined));
  }

  private datasetSubsample(
    value: CreateDatasetSubsampleDto,
    preservedId?: string
  ): DatasetSubsampleV1 {
    const zero = { min: 0, median: 0, max: 0 };
    return {
      id: preservedId ?? randomUUID(),
      name: value.name,
      nameEn: value.nameEn,
      description: value.description,
      split: value.split,
      sizeInSamples: value.sizeInSamples ?? 0,
      medianSampleSizeWords: value.medianSampleSizeWords ?? 0,
      requestLengthDist: { ...(value.requestLengthDist ?? zero) },
      responseLengthDist: { ...(value.responseLengthDist ?? zero) },
      examples: (value.examples ?? []).map((example) => ({ ...example })),
    };
  }

  private dictionaryValidationPayload(
    specification: BenchmarkTestSpecificationV1
  ): CreateBenchmarkTestDto {
    return {
      suiteId: specification.suiteId,
      name: specification.name,
      nameEn: specification.nameEn,
      description: specification.description,
      macroGroupId: specification.macroGroupId,
      subGroupIds: [...specification.subGroupIds],
      abilityTaxonIds: [...specification.abilityTaxonIds],
      taskTypeId: specification.taskTypeId,
      modalityIds: [...specification.modalityIds],
      languageId: specification.languageId,
      difficultyId: specification.difficultyId,
      capabilityIds: [...specification.capabilityIds],
      domainIds: [...specification.domainIds],
      subdomainIds: [...specification.subdomainIds],
    };
  }

  private async resolveMetricIds(
    tx: Prisma.TransactionClient,
    names: string[]
  ): Promise<string[]> {
    if (!names.length) return [];
    const priority = await tx.metricPriorityLookup.upsert({
      where: { code: 'primary' },
      update: {},
      create: {
        code: 'primary',
        name: 'Primary',
        description: 'Default primary metric priority',
      },
      select: { id: true },
    });
    const direction = await tx.metricDirectionLookup.upsert({
      where: { code: 'higher_is_better' },
      update: {},
      create: {
        code: 'higher_is_better',
        name: 'Higher is better',
        description: 'Default metric direction',
      },
      select: { id: true },
    });
    const ids: string[] = [];
    for (const name of names) {
      const metric = await tx.metricDefinition.upsert({
        where: { name },
        update: {},
        create: {
          name,
          displayName: name,
          priorityId: priority.id,
          directionId: direction.id,
          metadata: {},
        },
        select: { id: true },
      });
      ids.push(metric.id);
    }
    return ids;
  }

  private receipt(
    operationId: string,
    aggregateId: string,
    aggregateType: 'benchmark' | 'test' = 'benchmark'
  ): BenchmarkCommandReceiptDto {
    return {
      operationId,
      aggregateId,
      aggregateType,
      status: 'queued',
      statusUrl: `/api/benchmark-operations/${operationId}`,
    };
  }

  private async grantOperationAccess(
    tx: Prisma.TransactionClient,
    operationId: string,
    actorId?: string,
    resetSubmissionOnApplied = false
  ): Promise<void> {
    if (!actorId) return;
    await tx.benchmarkCommandActor.upsert({
      where: { commandEventId: operationId },
      create: { commandEventId: operationId, actorId, resetSubmissionOnApplied },
      update: {},
    });
  }
}
