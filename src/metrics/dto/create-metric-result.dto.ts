import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmpty,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  IsIn,
  MaxLength,
} from 'class-validator';

export class CreateMetricResultDto {
  @ApiPropertyOptional({
    deprecated: true,
    type: String,
    format: 'uuid',
    description: 'Run is not part of the current domain model.',
  })
  @IsEmpty({
    message: 'runId is not supported: Run is not implemented',
  })
  runId?: never;

  @ApiProperty({ example: 'postman-mmlu-ru-math-123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  testId!: string;

  @ApiPropertyOptional({
    deprecated: true,
    type: String,
    format: 'uuid',
    description:
      'DatasetSubsample-level results are not supported. MetricResult belongs to Test.',
  })
  @IsEmpty({
    message: 'subsetId is not supported: MetricResult belongs to Test',
  })
  subsetId?: never;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description:
      'DatasetSubsample-level results are not supported. MetricResult belongs to Test.',
  })
  @IsEmpty({
    message: 'subsampleId is not supported: MetricResult belongs to Test',
  })
  subsampleId?: never;

  @ApiProperty({ example: '5e2f13fb-7d3d-4c7a-8e48-854d1a57f1d6' })
  @IsUUID()
  metricId!: string;

  @ApiProperty({ example: 'gigachat-2-pro' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  modelId!: string;

  @ApiProperty({ example: 87.34 })
  @Type(() => Number)
  @IsNumber()
  value!: number;

  @ApiPropertyOptional({ example: '87.34%' })
  @IsOptional()
  @IsString()
  rawValue?: string;

  @ApiPropertyOptional({ example: '2026-05-26T10:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  obtainedAt?: string;

  @ApiPropertyOptional({ example: 'manual-postman' })
  @IsOptional()
  @IsString()
  importSource?: string;

  @ApiPropertyOptional({ example: { source: 'manual' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ['benchmark', 'stress', 'production', 'comparison', 'harness'] })
  @IsOptional()
  @IsIn(['benchmark', 'stress', 'production', 'comparison', 'harness'])
  sourceMode?: 'benchmark' | 'stress' | 'production' | 'comparison' | 'harness';
}
