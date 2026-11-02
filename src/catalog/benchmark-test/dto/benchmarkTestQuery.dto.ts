import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { IsRepeatedStringQuery } from '@/common/decorators/repeatedStringQuery.decorator';
import { PaginationDto } from '@/common/dtos/paginationDto.dto';
import { normalizeUuidArray } from '@/common/utils/normalizeUuidArray';

export enum BenchmarkSortColumn {
  CreatedAt = 'createdAt',
  Name = 'name',
  SizeInSamples = 'sizeInSamples',
  Difficulty = 'difficulty',
  Language = 'language'
}

export class BenchmarkTestQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(BenchmarkSortColumn)
  sortColumn?: BenchmarkSortColumn = BenchmarkSortColumn.CreatedAt;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description:
      'Filter BenchmarkTests by parent Benchmark suite ids. Repeat the param or use comma-separated: `?suiteIds=<uuid1>&suiteIds=<uuid2>` or `?suiteIds=<uuid1>,<uuid2>`.',
  })
  @IsOptional()
  @Transform(({ value }) => normalizeUuidArray(value))
  @IsRepeatedStringQuery()
  @IsUUID('all', { each: true })
  suiteIds?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid', description: 'DictMacroGroup ids' })
  @IsOptional()
  @Transform(({ value }) => normalizeUuidArray(value))
  @IsRepeatedStringQuery()
  @IsUUID('all', { each: true })
  macroGroupIds?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid', description: 'DictSubGroup ids' })
  @IsOptional()
  @Transform(({ value }) => normalizeUuidArray(value))
  @IsRepeatedStringQuery()
  @IsUUID('all', { each: true })
  subGroupIds?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid', description: 'DictAbilityTaxon ids' })
  @IsOptional()
  @Transform(({ value }) => normalizeUuidArray(value))
  @IsRepeatedStringQuery()
  @IsUUID('all', { each: true })
  abilityTaxonIds?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid', description: 'DictDomain ids' })
  @IsOptional()
  @Transform(({ value }) => normalizeUuidArray(value))
  @IsRepeatedStringQuery()
  @IsUUID('all', { each: true })
  domainIds?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid', description: 'DictSubdomain ids' })
  @IsOptional()
  @Transform(({ value }) => normalizeUuidArray(value))
  @IsRepeatedStringQuery()
  @IsUUID('all', { each: true })
  subdomainIds?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid', description: 'DictLanguage ids' })
  @IsOptional()
  @Transform(({ value }) => normalizeUuidArray(value))
  @IsRepeatedStringQuery()
  @IsUUID('all', { each: true })
  languageIds?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid', description: 'DictDifficulty ids' })
  @IsOptional()
  @Transform(({ value }) => normalizeUuidArray(value))
  @IsRepeatedStringQuery()
  @IsUUID('all', { each: true })
  difficultyIds?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid', description: 'DictTaskType ids' })
  @IsOptional()
  @Transform(({ value }) => normalizeUuidArray(value))
  @IsRepeatedStringQuery()
  @IsUUID('all', { each: true })
  taskTypeIds?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid', description: 'DictModality ids' })
  @IsOptional()
  @Transform(({ value }) => normalizeUuidArray(value))
  @IsRepeatedStringQuery()
  @IsUUID('all', { each: true })
  modalityIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description:
      'DictCapability ids. Replaces the removed fewShot/rag/tools/reasoning/longContext booleans.',
  })
  @IsOptional()
  @Transform(({ value }) => normalizeUuidArray(value))
  @IsRepeatedStringQuery()
  @IsUUID('all', { each: true })
  capabilityIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsRepeatedStringQuery()
  abilityTags?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsRepeatedStringQuery()
  skills?: string[];

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sizeMin?: number;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sizeMax?: number;
}
