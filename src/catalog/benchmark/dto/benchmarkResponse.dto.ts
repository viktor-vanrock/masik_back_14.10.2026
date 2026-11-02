import { ApiProperty } from '@nestjs/swagger';

export class BenchmarkResponseDto {
  @ApiProperty({
    example: '4442ee17-dd60-43f0-9421-ccceba3b1d13',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({ example: 'MERA: знания и код' })
  name!: string;

  @ApiProperty({ example: 'MERA: knowledge and code' })
  nameEn!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Агрегат по крупным русскоязычным бенчмаркам широких знаний',
  })
  description!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Aggregate of broad-knowledge Russian benchmarks',
  })
  descriptionEn!: string | null;

  @ApiProperty({
    example: 2,
    description: 'Number of active BenchmarkTest items belonging to this suite',
  })
  benchmarkTestsCount!: number;

  @ApiProperty({ example: '2026-06-10T15:31:57.169Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-06-10T15:31:57.169Z', format: 'date-time' })
  updatedAt!: string;
}

export class BenchmarkOptionDto {
  @ApiProperty({
    example: '4442ee17-dd60-43f0-9421-ccceba3b1d13',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({ example: 'MERA: знания и код' })
  name!: string;

  @ApiProperty({ example: 'MERA: knowledge and code' })
  nameEn!: string;
}

export class BenchmarkPaginatedResponseDto {
  @ApiProperty({ type: [BenchmarkResponseDto] })
  data!: BenchmarkResponseDto[];

  @ApiProperty({ example: 3 })
  total!: number;
}
