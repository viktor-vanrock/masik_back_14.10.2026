import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { IsOptionalIfUndefined } from '@/common/decorators/is-optional-if-undefined.decorator';

export class CreateMetricDefinitionDto {
  @ApiProperty({
    example: 'accuracy',
    description: 'Unique machine-readable metric name.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({
    example: 'Accuracy',
    description: 'Human-readable metric name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string | null;

  @ApiProperty({
    example: '5e2f13fb-7d3d-4c7a-8e48-854d1a57f1d6',
    description:
      'Metric priority id from GET /external/v1/metrics/lookups/priorities.',
  })
  @IsUUID()
  priorityId!: string;

  @ApiProperty({
    example: '7b174f05-b02e-46fd-88e8-f2c8954e92cf',
    description:
      'Metric direction id from GET /external/v1/metrics/lookups/directions.',
  })
  @IsUUID()
  directionId!: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minValue?: number | null;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxValue?: number | null;

  @ApiPropertyOptional({ example: 0.9 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  targetValue?: number | null;

  @ApiPropertyOptional({
    deprecated: true,
    type: String,
    description: 'Evaluation logic belongs to Test, not to Metric.',
  })
  @IsEmpty({ message: 'evaluationLogic belongs to Test, not to Metric' })
  evaluationLogic?: never;

  @ApiPropertyOptional({
    deprecated: true,
    type: String,
    description: 'Required GigaChat quality level belongs to Test.',
  })
  @IsEmpty({
    message: 'requiredGigaChatQualityLevel belongs to Test, not to Metric',
  })
  requiredGigaChatQualityLevel?: never;

  @ApiPropertyOptional({
    example: { source: 'external-evaluation-service' },
    type: Object,
  })
  @IsOptionalIfUndefined()
  @IsObject()
  metadata?: Record<string, unknown>;
}
