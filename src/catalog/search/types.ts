import {
  BenchmarkValidationStatus,
} from '@/generated/prisma/client';

type SearchNamePair = Readonly<{ name: string; nameEn: string }>;

/**
 * Catalog-owned representation used to build retrieval documents. It is
 * intentionally independent of the legacy BenchmarkTest Prisma relations so
 * the same builder can consume the benchmark-service projection.
 */
export type BenchmarkSearchSource = Readonly<{
  id: string;
  name: string;
  nameEn: string;
  description: string | null;
  descriptionEn: string | null;
  shortDescription: string | null;
  taskDescription: string | null;
  instructions: string | null;
  instructionsEn: string | null;
  contextFieldFormat: string | null;
  answerFieldFormat: string | null;
  evaluationLogic: string | null;
  recommendedMetricsDescription: string | null;
  requiredGigaChatQualityLevel: string | null;
  deletedAt: Date | null;
  updatedAt: Date;
  benchmark: Readonly<{
    name: string;
    nameEn: string;
    description: string | null;
    descriptionEn: string | null;
    deletedAt: Date | null;
  }>;
  macroGroup: SearchNamePair | null;
  taskType: SearchNamePair | null;
  language: SearchNamePair | null;
  difficulty: SearchNamePair | null;
  skills: readonly string[];
  abilityTags: readonly string[];
  subGroups: readonly SearchNamePair[];
  abilityTaxons: readonly SearchNamePair[];
  domains: readonly SearchNamePair[];
  subdomains: readonly SearchNamePair[];
  modalities: readonly SearchNamePair[];
  capabilities: readonly SearchNamePair[];
  datasetSubsamples: ReadonlyArray<{
    name: string;
    nameEn: string | null;
    description: string | null;
    split: string | null;
  }>;
  catalogEntry: Readonly<{
    status: BenchmarkValidationStatus;
    archivedAt: Date | null;
  }> | null;
}>;

export type EmbeddingVector = Readonly<{
  values: readonly number[];
  dimensions: number;
  model: string;
}>;

export type BenchmarkRetrievalCandidate = Readonly<{
  testId: string;
  document: string;
  score: number;
  sourceUpdatedAt: string;
}>;

export type BenchmarkRetrievalResult = Readonly<{
  candidates: readonly BenchmarkRetrievalCandidate[];
  retrievalVersion: string;
  durationMs: number;
  fallbackReason?: 'embedding_failed' | 'hybrid_search_failed' | 'hybrid_search_empty';
}>;

export type SearchDocumentUpsert = Readonly<{
  benchmarkTestId: string;
  documentText: string;
  contentHash: string;
  embedding: readonly number[];
  embeddingSpecId: string;
  sourceUpdatedAt: Date;
}>;

export type SearchDocumentRow = Readonly<{
  testId: string;
  document: string;
  vectorScore: number;
  score: number;
  sourceUpdatedAt: Date;
}>;
