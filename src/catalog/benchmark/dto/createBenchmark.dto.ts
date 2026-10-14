import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBenchmarkDto {
  @ApiProperty({ example: 'MERA: знания и код', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  name!: string;

  @ApiProperty({ example: 'MERA: knowledge and code', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  nameEn!: string;

  @ApiPropertyOptional({
    example: 'Агрегат по крупным русскоязычным бенчмаркам широких знаний',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: 'Aggregate of broad-knowledge Russian benchmarks',
  })
  @IsString()
  @IsOptional()
  descriptionEn?: string;
}
