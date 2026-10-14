import { ApiProperty } from '@nestjs/swagger';

export class BenchmarkCommandReceiptDto {
  @ApiProperty({ format: 'uuid' })
  operationId!: string;

  @ApiProperty({ format: 'uuid' })
  aggregateId!: string;

  @ApiProperty({ enum: ['benchmark', 'test'] })
  aggregateType!: 'benchmark' | 'test';

  @ApiProperty({ enum: ['queued'] })
  status!: 'queued';

  @ApiProperty({ example: '/api/benchmark-operations/00000000-0000-4000-8000-000000000000' })
  statusUrl!: string;
}

export function isBenchmarkCommandReceipt(
  value: unknown
): value is BenchmarkCommandReceiptDto {
  return (
    'object' === typeof value &&
    null !== value &&
    'operationId' in value
  );
}
