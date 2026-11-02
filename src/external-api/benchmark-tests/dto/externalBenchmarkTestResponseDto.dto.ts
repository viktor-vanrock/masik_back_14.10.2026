import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExternalBenchmarkDto {
  @ApiProperty({ example: 'mmlu-ru' })
  id!: string;

  @ApiProperty({ example: 'MMLU-RU' })
  name!: string;

  @ApiProperty({ example: 'MMLU-RU' })
  nameEn!: string;

  @ApiPropertyOptional({ example: 'Russian MMLU suite' })
  description?: string;

  @ApiPropertyOptional({ example: 'Russian MMLU suite' })
  descriptionEn?: string;
}

export class ExternalBenchmarkTestTaxonomyDto {
  @ApiPropertyOptional({ example: 'Text Foundational Capabilities' })
  macroGroup?: string;

  @ApiProperty({ type: [String], example: ['Knowledge & Comprehension'] })
  subGroups!: string[];

  @ApiProperty({ type: [String], example: ['Algebra'] })
  skills!: string[];

  @ApiProperty({ type: [String], example: ['Mathematical reasoning'] })
  abilityTaxons!: string[];

  @ApiProperty({ type: [String], example: ['math'] })
  abilityTags!: string[];

  @ApiProperty({ type: [String], example: ['Математика'] })
  domains!: string[];

  @ApiProperty({ type: [String], example: ['Алгебра'] })
  subdomains!: string[];

  @ApiProperty({ type: [String], example: ['text'] })
  modalities!: string[];
}

export class ExternalMetricDto {
  @ApiProperty({ example: '8cd0c2b8-7e3f-4c7b-8d4f-f1d1d2e3a4b5' })
  id!: string;

  @ApiProperty({ example: 'Accuracy' })
  name!: string;

  @ApiPropertyOptional({ example: 'Accuracy' })
  displayName?: string;

  @ApiPropertyOptional({ example: 'primary' })
  priority?: string;

  @ApiPropertyOptional({ example: 'higher_is_better' })
  direction?: string;
}

export class ExternalGigaMetricsDto {
  @ApiPropertyOptional({ example: 'https://gitverse.example/gigametrics' })
  codebaseUrl?: string;

  @ApiPropertyOptional({ example: 'mmlu_ru_math_adapter' })
  adapterName?: string;

  @ApiPropertyOptional({ example: 'https://obs.example/mmlu-ru/set.json' })
  setUrl?: string;

  @ApiPropertyOptional({
    example: 'gigametrics run --adapter mmlu_ru_math_adapter',
  })
  launchCommand?: string;
}

export class ExternalBenchmarkLinkDto {
  @ApiProperty({ example: 'obs' })
  type!: string;

  @ApiProperty({ example: 'OBS dataset' })
  title!: string;

  @ApiProperty({ example: 'https://obs.example/mmlu-ru/set.json' })
  url!: string;
}

export class ExternalBenchmarkTestDto {
  @ApiProperty({ example: 'mmlu-ru-math' })
  id!: string;

  @ApiProperty({ type: ExternalBenchmarkDto })
  benchmark!: ExternalBenchmarkDto;

  @ApiProperty({ example: 'MMLU-RU / Math' })
  name!: string;

  @ApiProperty({ example: 'MMLU-RU / Math' })
  nameEn!: string;

  @ApiPropertyOptional({ example: 'Math benchmark test' })
  description?: string;

  @ApiPropertyOptional({ example: 'Math benchmark test' })
  descriptionEn?: string;

  @ApiPropertyOptional({ example: 'Short description for agents' })
  shortDescription?: string;

  @ApiPropertyOptional({ example: 'Model should choose correct answer.' })
  taskDescription?: string;

  @ApiPropertyOptional({ example: 'MultipleChoice' })
  taskType?: string;

  @ApiPropertyOptional({ example: 'ru' })
  language?: string;

  @ApiPropertyOptional({ example: 'higher' })
  difficulty?: string;

  @ApiPropertyOptional({ example: 1000 })
  sizeInSamples?: number;

  @ApiPropertyOptional({ example: 45 })
  medianSampleSizeWords?: number;

  @ApiPropertyOptional({ example: 'validation' })
  validationStatus?: string;

  @ApiProperty({ type: ExternalBenchmarkTestTaxonomyDto })
  taxonomy!: ExternalBenchmarkTestTaxonomyDto;

  @ApiProperty({ type: [ExternalMetricDto] })
  metrics!: ExternalMetricDto[];

  @ApiProperty({ type: ExternalGigaMetricsDto })
  gigaMetrics!: ExternalGigaMetricsDto;

  @ApiProperty({ type: [ExternalBenchmarkLinkDto] })
  links!: ExternalBenchmarkLinkDto[];

  @ApiProperty({ example: '2026-06-03T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-06-03T10:00:00.000Z' })
  updatedAt!: string;
}

export class ExternalBenchmarkTestListResponseDto {
  @ApiProperty({ type: [ExternalBenchmarkTestDto] })
  data!: ExternalBenchmarkTestDto[];

  @ApiProperty({ example: 42 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  limit!: number;
}
