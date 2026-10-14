export enum ExternalBenchmarkTestField {
  Id = 'id',
  BenchmarkId = 'benchmarkId',
  Name = 'name',
  NameEn = 'nameEn',
  MacroGroup = 'macroGroup',
  TaskType = 'taskType',
  Language = 'language',
  Difficulty = 'difficulty',
  KnowledgeLevel = 'knowledgeLevel',
  ConfidentialityLevel = 'confidentialityLevel',
  Importance = 'importance',
  ValidationStatus = 'validationStatus',
  IsGenerated = 'isGenerated',

  Skills = 'skills',
  AbilityTaxons = 'abilityTaxons',
  AbilityTags = 'abilityTags',
  SubGroups = 'subGroups',
  Domains = 'domains',
  Subdomains = 'subdomains',
  Modalities = 'modalities',
  MetricNames = 'metricNames',
  LinkTypes = 'linkTypes'
}

export const EXTERNAL_BENCHMARK_TEST_FIELDS = Object.values(
  ExternalBenchmarkTestField
);
