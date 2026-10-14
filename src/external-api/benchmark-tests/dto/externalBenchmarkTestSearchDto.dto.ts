import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { SortDirection } from '@/common/enums/sortDirection.enum';
import { BenchmarkValidationStatus } from '@/generated/prisma/client';

export class ExternalNumberRangeDto {
  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  gte?: number;

  @ApiPropertyOptional({ example: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lte?: number;
}

export class ExternalDateRangeDto {
  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  gte?: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  lte?: string;
}

export class ExternalBenchmarkTestFiltersDto {
  @ApiPropertyOptional({ example: 'MMLU' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 'postman-mmlu-ru-suite' })
  @IsOptional()
  @IsString()
  benchmarkId?: string;

  @ApiPropertyOptional({ example: 'Text Foundational Capabilities' })
  @IsOptional()
  @IsString()
  macroGroup?: string;

  @ApiPropertyOptional({ example: 'MultipleChoice' })
  @IsOptional()
  @IsString()
  taskType?: string;

  @ApiPropertyOptional({ example: 'ru' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ example: 'higher' })
  @IsOptional()
  @IsString()
  difficulty?: string;

  @ApiPropertyOptional({ enum: BenchmarkValidationStatus })
  @IsOptional()
  @IsEnum(BenchmarkValidationStatus)
  validationStatus?: BenchmarkValidationStatus;

  @ApiPropertyOptional({ example: 'L1' })
  @IsOptional()
  @IsString()
  knowledgeLevel?: string;

  @ApiPropertyOptional({ example: 'internal' })
  @IsOptional()
  @IsString()
  confidentialityLevel?: string;

  @ApiPropertyOptional({ example: 'high' })
  @IsOptional()
  @IsString()
  importance?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isGenerated?: boolean;

  @ApiPropertyOptional({ type: [String], example: ['Algebra'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Mathematical reasoning'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  abilityTaxons?: string[];

  @ApiPropertyOptional({ type: [String], example: ['math'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  abilityTags?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['Knowledge & Comprehension'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  subGroups?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Математика'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  domains?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Алгебра'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  subdomains?: string[];

  @ApiPropertyOptional({ type: [String], example: ['text'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modalities?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Accuracy'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  metricNames?: string[];

  @ApiPropertyOptional({ type: [String], example: ['obs', 'gitverse'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  linkTypes?: string[];

  @ApiPropertyOptional({ type: ExternalNumberRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExternalNumberRangeDto)
  sizeInSamples?: ExternalNumberRangeDto;

  @ApiPropertyOptional({ type: ExternalNumberRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExternalNumberRangeDto)
  medianSampleSizeWords?: ExternalNumberRangeDto;

  @ApiPropertyOptional({ type: ExternalNumberRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExternalNumberRangeDto)
  confidenceScore?: ExternalNumberRangeDto;

  @ApiPropertyOptional({ type: ExternalDateRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExternalDateRangeDto)
  createdAt?: ExternalDateRangeDto;

  @ApiPropertyOptional({ type: ExternalDateRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExternalDateRangeDto)
  updatedAt?: ExternalDateRangeDto;

  @ApiPropertyOptional({ type: ExternalDateRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExternalDateRangeDto)
  generatedAt?: ExternalDateRangeDto;
}

export class ExternalBenchmarkTestPaginationDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit: number = 50;
}

export enum ExternalBenchmarkTestSortColumn {
  CreatedAt = 'createdAt',
  UpdatedAt = 'updatedAt',
  Name = 'name',
  NameEn = 'nameEn',
  SizeInSamples = 'sizeInSamples',
  Difficulty = 'difficulty',
  Language = 'language'
}

export class ExternalBenchmarkTestSortDto {
  @ApiPropertyOptional({
    enum: ExternalBenchmarkTestSortColumn,
    example: ExternalBenchmarkTestSortColumn.CreatedAt,
  })
  @IsOptional()
  @IsEnum(ExternalBenchmarkTestSortColumn)
  column?: ExternalBenchmarkTestSortColumn = ExternalBenchmarkTestSortColumn.CreatedAt;

  @ApiPropertyOptional({
    enum: SortDirection,
    example: SortDirection.Desc,
  })
  @IsOptional()
  @IsEnum(SortDirection)
  direction?: SortDirection = SortDirection.Desc;
}

export class ExternalBenchmarkTestSearchDto {
  @ApiPropertyOptional({ type: ExternalBenchmarkTestFiltersDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExternalBenchmarkTestFiltersDto)
  filters?: ExternalBenchmarkTestFiltersDto;

  @ApiPropertyOptional({ type: ExternalBenchmarkTestPaginationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExternalBenchmarkTestPaginationDto)
  pagination?: ExternalBenchmarkTestPaginationDto;

  @ApiPropertyOptional({ type: ExternalBenchmarkTestSortDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExternalBenchmarkTestSortDto)
  sort?: ExternalBenchmarkTestSortDto;
}
