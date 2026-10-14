import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '@/common/dtos/paginationDto.dto';
import { AnalyticsEventType } from '../analytics-event-type.enum';

export class AnalyticsEventsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    example: '2026-07-01',
    description:
      'Inclusive start date/time. If omitted, backend uses the last 30 days.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-07-10',
    description: 'Inclusive end date/time. If omitted, backend uses now.',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: AnalyticsEventType })
  @IsOptional()
  @IsEnum(AnalyticsEventType)
  type?: AnalyticsEventType;

  @ApiPropertyOptional({ example: '6d338b8f-4f4a-438f-a111-7be8f859e20e' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  benchmarkId?: string;

  @ApiPropertyOptional({ example: 'postman-mmlu-ru-math-123' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  benchmarkTestId?: string;
}
