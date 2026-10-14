import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class AnalyticsDateRangeQueryDto {
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
}
