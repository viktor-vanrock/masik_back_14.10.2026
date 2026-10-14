import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class TrackBenchmarkViewDto {
  @ApiProperty({
    example: '6d338b8f-4f4a-438f-a111-7be8f859e20e',
    description: 'Parent Benchmark suite id.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  benchmarkId!: string;

  @ApiPropertyOptional({
    example: 'postman-mmlu-ru-math-123',
    description:
      'Optional BenchmarkTest card id. If passed, the event is stored as benchmark_test_view.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  benchmarkTestId?: string;

  @ApiPropertyOptional({
    example: 'web-session-1736290000',
    description:
      'Optional anonymous frontend session id. Backend stores only sha256 hash.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sessionId?: string;

  @ApiPropertyOptional({
    example: { source: 'benchmark-card', page: 'catalog' },
    description: 'Optional frontend context. Do not send personal data here.',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
