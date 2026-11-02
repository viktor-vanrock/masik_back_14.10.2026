import { ApiProperty } from '@nestjs/swagger';

export class BenchmarkGroupSuiteDto {
  @ApiProperty({
    example: '4442ee17-dd60-43f0-9421-ccceba3b1d13',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({ example: 'MERA: знания и код' })
  name!: string;

  @ApiProperty({ example: 'MERA: knowledge and code' })
  nameEn!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: String, nullable: true })
  descriptionEn!: string | null;

  @ApiProperty({
    example: 2,
    description: 'Total active BenchmarkTest items in this suite',
  })
  benchmarkTestsCount!: number;

  @ApiProperty({
    example: 2,
    description: 'BenchmarkTest items matching current filters/search',
  })
  matchedTestsCount!: number;
}

export class BenchmarkGroupDto {
  @ApiProperty({ type: BenchmarkGroupSuiteDto })
  benchmark!: BenchmarkGroupSuiteDto;

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: 'Array of BenchmarkType cards (same shape as GET /benchmark-tests)',
  })
  tests!: unknown[];
}

export class CatalogPaginatedResponseDto {
  @ApiProperty({ type: [BenchmarkGroupDto] })
  data!: BenchmarkGroupDto[];

  @ApiProperty({
    example: 3,
    description: 'Number of suite groups (not tests)',
  })
  total!: number;
}
