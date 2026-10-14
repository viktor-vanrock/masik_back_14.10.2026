import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDictionaryItemDto {
  @ApiProperty({ example: 'Знания', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  name!: string;

  @ApiProperty({ example: 'Knowledge', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  nameEn!: string;

  @ApiPropertyOptional({ example: 'Группа задач на проверку знаний' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'Knowledge-checking task group' })
  @IsString()
  @IsOptional()
  descriptionEn?: string;
}
