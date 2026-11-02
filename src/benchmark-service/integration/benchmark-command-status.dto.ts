import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const BENCHMARK_COMMAND_STATUSES = [
  'queued',
  'processing',
  'applied',
  'rejected',
] as const;

export type BenchmarkCommandStatus =
  (typeof BENCHMARK_COMMAND_STATUSES)[number];

export class BenchmarkCommandStatusDto {
  @ApiProperty({ format: 'uuid' })
  commandEventId!: string;

  @ApiProperty()
  commandEventType!: string;

  @ApiProperty({ enum: ['benchmark', 'test'] })
  aggregateType!: 'benchmark' | 'test';

  @ApiProperty({ format: 'uuid' })
  aggregateId!: string;

  @ApiProperty({ enum: BENCHMARK_COMMAND_STATUSES })
  status!: BenchmarkCommandStatus;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  submittedAt!: Date | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  publishedAt!: Date | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  completedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  reasonCode!: string | null;

  @ApiPropertyOptional({ enum: [400, 404, 409], nullable: true })
  statusCode!: 400 | 404 | 409 | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  deletedId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  message!: string | null;
}
