import { Injectable } from '@nestjs/common';
import {
  BenchmarkTestSnapshotV1,
  parseBenchmarkTestSnapshotV1,
} from '@/benchmark-service/contracts/benchmark-integration.v1';
import {
  BenchmarkValidationStatus,
  Prisma,
} from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { BenchmarkTestReadScope } from '../benchmark-test/benchmark-test-read-scope';
import { BenchmarkType, ModelScoreType } from '../benchmark-test/types';
import { DictionaryRefType } from '../settings/dictionary.types';

type CatalogEntryRow = {
  id: string;
  testId: string;
  status: BenchmarkValidationStatus;
  authorId: string | null;
  sourceConversationId: string | null;
  rejectionReason: string | null;
  reviewedById: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
};

const metricResultInclude = {
  metric: { select: { id: true, name: true } },
  model: { select: { id: true, name: true, isOpenSource: true } },
} satisfies Prisma.MetricResultInclude;

type MetricResultRow = Prisma.MetricResultGetPayload<{
  include: typeof metricResultInclude;
}>;

@Injectable()
export class CatalogTestProjectionHydrator {
  constructor(private readonly prisma: PrismaService) {}

  async hydrate(
    ids: string[],
    scope: BenchmarkTestReadScope
  ): Promise<BenchmarkType[]> {
    if (!ids.length) return [];

    const projections = await this.prisma.catalogTestProjection.findMany({
      where: { testId: { in: ids } },
      select: { testId: true, benchmarkId: true, snapshot: true },
    });
    const snapshots = new Map<string, BenchmarkTestSnapshotV1>();
    for (const projection of projections) {
      snapshots.set(
        projection.testId,
        parseBenchmarkTestSnapshotV1(projection.snapshot)
      );
    }

    const suiteIds = this.unique(
      projections.map(({ benchmarkId }) => benchmarkId).filter(this.isString)
    );
    const specifications = [...snapshots.values()].map(
      ({ specification }) => specification
    );
    const catalogEntriesPromise = this.prisma.catalogEntry.findMany({
      where: { testId: { in: ids } },
      select: {
        id: true,
        testId: true,
        status: true,
        authorId: true,
        sourceConversationId: true,
        rejectionReason: true,
        reviewedById: true,
        submittedAt: true,
        reviewedAt: true,
      },
    });

    const [
      suites,
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
      metrics,
      metricResults,
      catalogEntries,
    ] = await Promise.all([
      this.prisma.catalogBenchmarkProjection.findMany({
        where: { benchmarkId: { in: suiteIds } },
      }),
      this.prisma.dictMacroGroup.findMany({
        where: { id: { in: this.singleIds(specifications, 'macroGroupId') } },
      }),
      this.prisma.dictSubGroup.findMany({
        where: { id: { in: this.arrayIds(specifications, 'subGroupIds') } },
      }),
      this.prisma.dictAbilityTaxon.findMany({
        where: { id: { in: this.arrayIds(specifications, 'abilityTaxonIds') } },
      }),
      this.prisma.dictTaskType.findMany({
        where: { id: { in: this.singleIds(specifications, 'taskTypeId') } },
      }),
      this.prisma.dictModality.findMany({
        where: { id: { in: this.arrayIds(specifications, 'modalityIds') } },
      }),
      this.prisma.dictLanguage.findMany({
        where: { id: { in: this.singleIds(specifications, 'languageId') } },
      }),
      this.prisma.dictDifficulty.findMany({
        where: { id: { in: this.singleIds(specifications, 'difficultyId') } },
      }),
      this.prisma.dictCapability.findMany({
        where: { id: { in: this.arrayIds(specifications, 'capabilityIds') } },
      }),
      this.prisma.dictDomain.findMany({
        where: { id: { in: this.arrayIds(specifications, 'domainIds') } },
      }),
      this.prisma.dictSubdomain.findMany({
        where: { id: { in: this.arrayIds(specifications, 'subdomainIds') } },
      }),
      this.prisma.metricDefinition.findMany({
        where: { id: { in: this.arrayIds(specifications, 'metricIds') } },
      }),
      this.prisma.metricResult.findMany({
        where: { testId: { in: ids } },
        include: metricResultInclude,
        orderBy: { obtainedAt: 'desc' },
      }),
      catalogEntriesPromise,
    ]);

    const projectionById = new Map(
      projections.map((projection) => [projection.testId, projection])
    );
    const suiteById = new Map(
      suites.map((suite) => [suite.benchmarkId, suite])
    );
    const catalogEntryByTestId = new Map(
      catalogEntries.map((entry) => [entry.testId, entry])
    );
    const resultsByTestId = new Map<string, MetricResultRow[]>();
    for (const result of metricResults) {
      const bucket = resultsByTestId.get(result.testId) ?? [];
      bucket.push(result);
      resultsByTestId.set(result.testId, bucket);
    }
    const dictionaries = {
      macroGroups: this.refMap(macroGroups),
      subGroups: this.refMap(subGroups),
      abilityTaxons: this.refMap(abilityTaxons),
      taskTypes: this.refMap(taskTypes),
      modalities: this.refMap(modalities),
      languages: this.refMap(languages),
      difficulties: this.refMap(difficulties),
      capabilities: this.refMap(capabilities),
      domains: this.refMap(domains),
      subdomains: this.refMap(subdomains),
      metrics: new Map(metrics.map((metric) => [metric.id, metric.name])),
    };

    return ids.map((id) => {
      const snapshot = snapshots.get(id)!;
      const projection = projectionById.get(id)!;
      return this.toDto(
        snapshot,
        suiteById.get(projection.benchmarkId ?? ''),
        catalogEntryByTestId.get(id),
        resultsByTestId.get(id) ?? [],
        dictionaries,
        BenchmarkTestReadScope.Management === scope
      );
    });
  }

  private toDto(
    snapshot: BenchmarkTestSnapshotV1,
    suite: {
      description: string | null;
      descriptionEn: string | null;
    } | undefined,
    catalogEntry: CatalogEntryRow | undefined,
    metricResults: MetricResultRow[],
    dictionaries: {
      macroGroups: Map<string, DictionaryRefType>;
      subGroups: Map<string, DictionaryRefType>;
      abilityTaxons: Map<string, DictionaryRefType>;
      taskTypes: Map<string, DictionaryRefType>;
      modalities: Map<string, DictionaryRefType>;
      languages: Map<string, DictionaryRefType>;
      difficulties: Map<string, DictionaryRefType>;
      capabilities: Map<string, DictionaryRefType>;
      domains: Map<string, DictionaryRefType>;
      subdomains: Map<string, DictionaryRefType>;
      metrics: Map<string, string>;
    },
    includeCatalogMetadata: boolean
  ): BenchmarkType {
    const specification = snapshot.specification;
    return {
      id: snapshot.id.toLowerCase(),
      suiteId: specification.suiteId.toLowerCase(),
      name: specification.name,
      nameEn: specification.nameEn,
      description: specification.description ?? suite?.description ?? '',
      descriptionEn:
        specification.descriptionEn ?? suite?.descriptionEn ?? '',
      shortDescription: specification.shortDescription,
      taskDescription: specification.taskDescription,
      codebase: {
        name: specification.codebase?.name ?? '',
        url: specification.codebase?.url ?? '',
      },
      metrics: specification.metricIds
        .map((id) => dictionaries.metrics.get(id.toLowerCase()))
        .filter(this.isString),
      examples: specification.examples.map((example) => ({ ...example })),
      instructions: specification.instructions ?? '',
      instructionsEn: specification.instructionsEn ?? '',
      references: specification.references.map((reference) => ({ ...reference })),
      links: specification.links.map((link) => ({ ...link })),
      macroGroup: this.ref(specification.macroGroupId, dictionaries.macroGroups),
      taskType: this.ref(specification.taskTypeId, dictionaries.taskTypes),
      language: this.ref(specification.languageId, dictionaries.languages),
      difficulty: this.ref(specification.difficultyId, dictionaries.difficulties),
      subGroups: this.refs(specification.subGroupIds, dictionaries.subGroups),
      abilityTaxons: this.refs(
        specification.abilityTaxonIds,
        dictionaries.abilityTaxons
      ),
      domains: this.refs(specification.domainIds, dictionaries.domains),
      subdomains: this.refs(
        specification.subdomainIds,
        dictionaries.subdomains
      ),
      modalities: this.refs(
        specification.modalityIds,
        dictionaries.modalities
      ),
      capabilities: this.refs(
        specification.capabilityIds,
        dictionaries.capabilities
      ),
      abilityTags: [...specification.abilityTags],
      skills: [...specification.skills],
      sizeInSamples: specification.sizeInSamples,
      medianSampleSizeWords: specification.medianSampleSizeWords,
      requestLengthDist: { ...specification.requestLengthDist },
      responseLengthDist: { ...specification.responseLengthDist },
      confidenceScore: specification.confidenceScore,
      confidentialityLevel: specification.confidentialityLevel,
      knowledgeLevel: specification.knowledgeLevel,
      importance: specification.importance,
      importanceComment: specification.importanceComment,
      contextFieldFormat: specification.contextFieldFormat,
      answerFieldFormat: specification.answerFieldFormat,
      evaluationLogic: specification.evaluationLogic,
      humanBaseline: specification.humanBaseline,
      humanBaselineNotes: specification.humanBaselineNotes,
      recommendedMetricsDescription:
        specification.recommendedMetricsDescription,
      requiredGigaChatQualityLevel:
        specification.requiredGigaChatQualityLevel,
      scores: this.toMetricScores(metricResults),
      datasetSubsamples: specification.datasetSubsamples.map((subsample) => ({
        ...subsample,
        requestLengthDist: { ...subsample.requestLengthDist },
        responseLengthDist: { ...subsample.responseLengthDist },
        examples: subsample.examples.map((example) => ({ ...example })),
      })),
      gigaMetricAdapterName: specification.gigaMetricAdapterName,
      gigaMetricSetUrl: specification.gigaMetricSetUrl,
      gigaMetricLaunchCommand: specification.gigaMetricLaunchCommand,
      gigaMetricsCodebaseUrl: specification.gigaMetricsCodebaseUrl,
      validationStatus: catalogEntry?.status,
      ...(includeCatalogMetadata && catalogEntry
        ? { catalogEntry: this.catalogEntryDto(catalogEntry) }
        : {}),
      isGenerated: specification.isGenerated,
      jiraTicketId: specification.jiraTicketId,
      generatedAt: specification.generatedAt,
    };
  }

  private toMetricScores(results: MetricResultRow[]): ModelScoreType[] {
    const scores = new Map<string, ModelScoreType>();
    for (const result of results) {
      if ('human' === result.modelId.toLocaleLowerCase()) continue;
      const key = `${result.modelId}:${result.metricId}`;
      if (scores.has(key)) continue;
      scores.set(key, {
        modelId: result.modelId,
        modelName: result.model.name,
        metricId: result.metricId,
        metricName: result.metric.name,
        score: Number(result.value),
        isOpenSource: result.model.isOpenSource,
        isHumanBaseline: false,
        obtainedAt: result.obtainedAt.toISOString(),
      });
    }
    return [...scores.values()];
  }

  private catalogEntryDto(entry: CatalogEntryRow) {
    return {
      id: entry.id,
      status: entry.status,
      authorId: entry.authorId,
      sourceConversationId: entry.sourceConversationId,
      rejectionReason: entry.rejectionReason,
      reviewedById: entry.reviewedById,
      submittedAt: entry.submittedAt.toISOString(),
      reviewedAt: entry.reviewedAt?.toISOString() ?? null,
    };
  }

  private singleIds<
    T extends 'macroGroupId' | 'taskTypeId' | 'languageId' | 'difficultyId'
  >(
    specifications: BenchmarkTestSnapshotV1['specification'][],
    key: T
  ): string[] {
    return this.unique(
      specifications.map((specification) => specification[key]).filter(this.isString)
    );
  }

  private arrayIds<
    T extends
      | 'subGroupIds'
      | 'abilityTaxonIds'
      | 'modalityIds'
      | 'capabilityIds'
      | 'domainIds'
      | 'subdomainIds'
      | 'metricIds'
  >(
    specifications: BenchmarkTestSnapshotV1['specification'][],
    key: T
  ): string[] {
    return this.unique(specifications.flatMap((specification) => specification[key]));
  }

  private ref(
    id: string | null | undefined,
    values: Map<string, DictionaryRefType>
  ): DictionaryRefType | null {
    return id ? values.get(id.toLowerCase()) ?? null : null;
  }

  private refs(
    ids: readonly string[],
    values: Map<string, DictionaryRefType>
  ): DictionaryRefType[] {
    return ids.map((id) => values.get(id.toLowerCase())).filter(this.isDefined);
  }

  private refMap(
    rows: Array<{ id: string; name: string; nameEn: string }>
  ): Map<string, DictionaryRefType> {
    return new Map(
      rows.map((row) => [
        row.id,
        { id: row.id, name: row.name, nameEn: row.nameEn },
      ])
    );
  }

  private unique(values: string[]): string[] {
    return [...new Set(values)];
  }

  private readonly isString = (value: string | null | undefined): value is string =>
    'string' === typeof value;

  private readonly isDefined = <T>(value: T | undefined): value is T =>
    value !== undefined;
}
