import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmpty,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { BENCHMARK_LINK_TYPES } from '@/benchmark-service/contracts/benchmark-integration.v1';
import { IsOptionalIfUndefined } from '@/common/decorators/is-optional-if-undefined.decorator';

type BenchmarkLinkKind = (typeof BENCHMARK_LINK_TYPES)[number];

export class BenchmarkCodebaseDto {
  @IsString()
  @MaxLength(255)
  @IsOptionalIfUndefined()
  name?: string;

  @IsUrl({
    protocols: ['http', 'https'],
    require_tld: false,
    require_protocol: true,
  })
  @MaxLength(2000)
  url!: string;
}

export class BenchmarkLengthDistributionDto {
  @IsInt()
  @Min(0)
  min!: number;

  @IsInt()
  @Min(0)
  median!: number;

  @IsInt()
  @Min(0)
  max!: number;
}

export class BenchmarkExampleDto {
  @IsString()
  @IsNotEmpty()
  input!: string;

  @IsString()
  output!: string;

  @IsString()
  @IsOptionalIfUndefined()
  explanation?: string;
}

export class BenchmarkReferenceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title!: string;

  @IsUrl({
    protocols: ['http', 'https'],
    require_tld: false,
    require_protocol: true,
  })
  @MaxLength(2000)
  url!: string;
}

export class BenchmarkLinkDto {
  @IsIn(BENCHMARK_LINK_TYPES)
  type!: BenchmarkLinkKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title!: string;

  @IsUrl({
    protocols: ['http', 'https'],
    require_tld: false,
    require_protocol: true,
  })
  @MaxLength(2000)
  url!: string;
}

export class CreateDatasetSubsampleDto {
  @ApiPropertyOptional({
    description:
      'Existing DatasetSubsample id. Send it back on Test update to preserve identity; ignored on create.',
  })
  @IsString()
  @MaxLength(160)
  @IsOptionalIfUndefined()
  id?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  nameEn!: string;

  @IsString()
  @IsOptionalIfUndefined()
  description?: string;

  @ApiPropertyOptional({
    deprecated: true,
    type: String,
    format: 'uuid',
    description: 'DatasetSubsample uses the taxonomy of its parent Test.',
  })
  @IsEmpty({
    message: 'DatasetSubsample taskTypeId must be inherited from Test',
  })
  taskTypeId?: never;

  @IsInt()
  @Min(0)
  @IsOptionalIfUndefined()
  sizeInSamples?: number;

  @IsInt()
  @Min(0)
  @IsOptionalIfUndefined()
  medianSampleSizeWords?: number;

  @ValidateNested()
  @Type(() => BenchmarkLengthDistributionDto)
  @IsOptionalIfUndefined()
  requestLengthDist?: BenchmarkLengthDistributionDto;

  @ValidateNested()
  @Type(() => BenchmarkLengthDistributionDto)
  @IsOptionalIfUndefined()
  responseLengthDist?: BenchmarkLengthDistributionDto;

  @IsString()
  @MaxLength(120)
  @IsOptionalIfUndefined()
  split?: string;

  @ApiPropertyOptional({
    deprecated: true,
    type: [String],
    description: 'DatasetSubsample uses the domains of its parent Test.',
  })
  @IsEmpty({
    message: 'DatasetSubsample domainIds must be inherited from Test',
  })
  domainIds?: never;

  @ApiPropertyOptional({
    deprecated: true,
    type: [String],
    description: 'DatasetSubsample uses the subdomains of its parent Test.',
  })
  @IsEmpty({
    message: 'DatasetSubsample subdomainIds must be inherited from Test',
  })
  subdomainIds?: never;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BenchmarkExampleDto)
  @IsOptionalIfUndefined()
  examples?: BenchmarkExampleDto[];
}

export class CreateBenchmarkTestDto {
  @ApiProperty({
    description:
      'UUID of the parent Benchmark suite. Must reference an existing non-deleted Benchmark.',
    example: '4442ee17-dd60-43f0-9421-ccceba3b1d13',
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  suiteId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  nameEn!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsString()
  @IsOptionalIfUndefined()
  descriptionEn?: string;

  @IsString()
  @IsOptionalIfUndefined()
  shortDescription?: string;

  @IsString()
  @IsOptionalIfUndefined()
  taskDescription?: string;

  @IsString()
  @IsOptionalIfUndefined()
  instructions?: string;

  @IsString()
  @IsOptionalIfUndefined()
  instructionsEn?: string;

  @ValidateNested()
  @Type(() => BenchmarkCodebaseDto)
  @IsOptional()
  codebase?: BenchmarkCodebaseDto | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'DictMacroGroup id' })
  @IsUUID()
  @IsOptional()
  macroGroupId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'DictTaskType id' })
  @IsUUID()
  @IsOptional()
  taskTypeId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'DictLanguage id' })
  @IsUUID()
  @IsOptional()
  languageId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'DictDifficulty id' })
  @IsUUID()
  @IsOptional()
  difficultyId?: string | null;

  @IsNumber()
  @IsOptionalIfUndefined()
  confidenceScore?: number;

  @IsString()
  @IsOptionalIfUndefined()
  confidentialityLevel?: string;

  @IsString()
  @IsOptionalIfUndefined()
  knowledgeLevel?: string;

  @IsString()
  @IsOptionalIfUndefined()
  importance?: string;

  @IsString()
  @IsOptionalIfUndefined()
  importanceComment?: string;

  @IsString()
  @IsOptionalIfUndefined()
  contextFieldFormat?: string;

  @IsString()
  @IsOptionalIfUndefined()
  answerFieldFormat?: string;

  @IsString()
  @IsOptionalIfUndefined()
  evaluationLogic?: string;

  @IsNumber()
  @IsOptionalIfUndefined()
  humanBaseline?: number;

  @IsString()
  @IsOptionalIfUndefined()
  humanBaselineNotes?: string;

  @IsString()
  @IsOptionalIfUndefined()
  recommendedMetricsDescription?: string;

  @IsString()
  @IsOptionalIfUndefined()
  requiredGigaChatQualityLevel?: string;

  @IsInt()
  @Min(0)
  @IsOptionalIfUndefined()
  sizeInSamples?: number;

  @IsInt()
  @Min(0)
  @IsOptionalIfUndefined()
  medianSampleSizeWords?: number;

  @ValidateNested()
  @Type(() => BenchmarkLengthDistributionDto)
  @IsOptionalIfUndefined()
  requestLengthDist?: BenchmarkLengthDistributionDto;

  @ValidateNested()
  @Type(() => BenchmarkLengthDistributionDto)
  @IsOptionalIfUndefined()
  responseLengthDist?: BenchmarkLengthDistributionDto;

  @IsBoolean()
  @IsOptionalIfUndefined()
  isDifficultyAutoCalculated?: boolean;

  @IsString()
  @IsOptionalIfUndefined()
  difficultyCalculationComment?: string;

  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(255, { each: true })
  @IsOptionalIfUndefined()
  skills?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(255, { each: true })
  @IsOptionalIfUndefined()
  abilityTags?: string[];

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'DictSubGroup ids; each subGroup.macroGroupId must equal macroGroupId',
  })
  @IsArray()
  @IsUUID('all', { each: true })
  @IsOptionalIfUndefined()
  subGroupIds?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid', description: 'DictAbilityTaxon ids' })
  @IsArray()
  @IsUUID('all', { each: true })
  @IsOptionalIfUndefined()
  abilityTaxonIds?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid', description: 'DictDomain ids' })
  @IsArray()
  @IsUUID('all', { each: true })
  @IsOptionalIfUndefined()
  domainIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'DictSubdomain ids; each subdomain.domainId must be in domainIds',
  })
  @IsArray()
  @IsUUID('all', { each: true })
  @IsOptionalIfUndefined()
  subdomainIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'DictModality ids (no direction — input/output split removed)',
  })
  @IsArray()
  @IsUUID('all', { each: true })
  @IsOptionalIfUndefined()
  modalityIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description:
      'DictCapability ids (replace removed fewShot/rag/tools/reasoning/longContext booleans)',
  })
  @IsArray()
  @IsUUID('all', { each: true })
  @IsOptionalIfUndefined()
  capabilityIds?: string[];

  // ── Untouched repeated fields ──

  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(255, { each: true })
  @IsOptionalIfUndefined()
  metrics?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BenchmarkExampleDto)
  @IsOptionalIfUndefined()
  examples?: BenchmarkExampleDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BenchmarkReferenceDto)
  @IsOptionalIfUndefined()
  references?: BenchmarkReferenceDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BenchmarkLinkDto)
  @IsOptionalIfUndefined()
  links?: BenchmarkLinkDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDatasetSubsampleDto)
  @IsOptionalIfUndefined()
  datasetSubsamples?: CreateDatasetSubsampleDto[];

  @IsString()
  @MaxLength(2000)
  @IsOptionalIfUndefined()
  gigaMetricsCodebaseUrl?: string;

  @IsString()
  @MaxLength(255)
  @IsOptionalIfUndefined()
  gigaMetricAdapterName?: string;

  @IsString()
  @MaxLength(2000)
  @IsOptionalIfUndefined()
  gigaMetricSetUrl?: string;

  @IsString()
  @IsOptionalIfUndefined()
  gigaMetricLaunchCommand?: string;

  @ApiPropertyOptional({
    type: String,
    readOnly: true,
    description:
      'Catalog moderation state is not part of the Test specification. Use the catalog moderation endpoint.',
  })
  @IsEmpty({
    message: 'validationStatus belongs to CatalogEntry and cannot be changed through the Test API',
  })
  validationStatus?: never;

  @IsBoolean()
  @IsOptionalIfUndefined()
  isGenerated?: boolean;

  @IsString()
  @MaxLength(255)
  @IsOptionalIfUndefined()
  jiraTicketId?: string;
}
