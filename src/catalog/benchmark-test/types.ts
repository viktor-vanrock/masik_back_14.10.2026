import { DictionaryRefType } from '../settings/dictionary.types';

export type ModelScoreType = {
  modelId: string;
  modelName: string;
  metricId?: string;
  metricName?: string;
  score: number;
  isOpenSource: boolean;
  isHumanBaseline?: boolean;
  obtainedAt?: string;
};

export type BenchmarkExampleType = {
  input: string;
  output: string;
  explanation?: string;
};

export type BenchmarkReferenceType = {
  title: string;
  url: string;
};

export type BenchmarkLinkType = {
  type: string;
  title: string;
  url: string;
};

export type BenchmarkLengthDistributionType = {
  min: number;
  median: number;
  max: number;
};

export type DatasetSubsampleType = {
  id: string;
  name: string;
  nameEn: string;
  description?: string;
  split?: string;
  sizeInSamples: number;
  medianSampleSizeWords: number;
  requestLengthDist: BenchmarkLengthDistributionType;
  responseLengthDist: BenchmarkLengthDistributionType;
  examples?: BenchmarkExampleType[];
};

export type CodeBaseType = {
  name: string;
  url: string;
};

export type BenchmarkType = {
  id: string;
  suiteId?: string;

  name: string;
  nameEn: string;

  description: string;
  descriptionEn: string;

  shortDescription?: string;
  taskDescription?: string;

  codebase: CodeBaseType;

  metrics: string[];
  examples: BenchmarkExampleType[];

  instructions: string;
  instructionsEn: string;

  references: BenchmarkReferenceType[];
  links: BenchmarkLinkType[];

  macroGroup: DictionaryRefType | null;
  subGroups: DictionaryRefType[];
  abilityTaxons: DictionaryRefType[];

  taskType: DictionaryRefType | null;
  modalities: DictionaryRefType[];
  language: DictionaryRefType | null;
  difficulty: DictionaryRefType | null;
  capabilities: DictionaryRefType[];

  domains: DictionaryRefType[];
  subdomains: DictionaryRefType[];

  abilityTags: string[];
  skills: string[];

  sizeInSamples: number;
  medianSampleSizeWords: number;

  requestLengthDist: BenchmarkLengthDistributionType;
  responseLengthDist: BenchmarkLengthDistributionType;

  confidenceScore?: number;
  confidentialityLevel?: string;
  knowledgeLevel?: string;
  importance?: string;
  importanceComment?: string;

  contextFieldFormat?: string;
  answerFieldFormat?: string;
  evaluationLogic?: string;

  humanBaseline?: number;
  humanBaselineNotes?: string;

  recommendedMetricsDescription?: string;
  requiredGigaChatQualityLevel?: string;

  scores: ModelScoreType[];
  datasetSubsamples: DatasetSubsampleType[];

  gigaMetricAdapterName?: string;
  gigaMetricSetUrl?: string;
  gigaMetricLaunchCommand?: string;
  gigaMetricsCodebaseUrl?: string;

  validationStatus?: string;
  catalogEntry?: {
    id: string;
    status: string;
    authorId: string | null;
    sourceConversationId: string | null;
    rejectionReason: string | null;
    reviewedById: string | null;
    submittedAt: string;
    reviewedAt: string | null;
  };
  isGenerated: boolean;
  jiraTicketId?: string;
  generatedAt?: string;
};

export type BenchmarkTestFilterOptionsType = {
  macroGroups: DictionaryRefType[];
  subGroups: Array<DictionaryRefType & { macroGroupId: string }>;
  abilityTaxons: DictionaryRefType[];
  taskTypes: DictionaryRefType[];
  modalities: DictionaryRefType[];
  languages: DictionaryRefType[];
  difficulties: DictionaryRefType[];
  capabilities: DictionaryRefType[];
  domains: DictionaryRefType[];
  subdomains: Array<DictionaryRefType & { domainId: string }>;
  skills: string[];
  abilityTags: string[];
};
