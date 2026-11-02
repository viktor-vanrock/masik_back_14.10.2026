import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { AnalyticsEventType } from '../analytics-event-type.enum';

export class TrackCatalogEventDto {
  @ApiProperty({
    enum: [AnalyticsEventType.CatalogSearch, AnalyticsEventType.FilterUsage],
    example: AnalyticsEventType.CatalogSearch,
  })
  @IsEnum(AnalyticsEventType)
  type!: typeof AnalyticsEventType.CatalogSearch | typeof AnalyticsEventType.FilterUsage;

  @ApiPropertyOptional({ example: 'math reasoning' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  search?: string;

  @ApiPropertyOptional({
    example: {
      domains: ['Math'],
      language: ['ru'],
      difficulty: ['expert'],
    },
  })
  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;

  @ApiPropertyOptional({
    example: 'web-session-1736290000',
    description:
      'Optional anonymous frontend session id. Backend stores only sha256 hash.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sessionId?: string;

  @ApiPropertyOptional({ example: { page: 'catalog' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
