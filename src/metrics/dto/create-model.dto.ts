import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { MODEL_ARCHITECTURES } from '@/leaderboard-boards/leaderboard-values';

export class CreateModelDto {
  @ApiProperty({ example: 'gigachat-2-pro' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  id!: string;

  @ApiProperty({ example: 'GigaChat 2 Pro' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ example: 'Sber' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  provider?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isOpenSource?: boolean;

  @ApiPropertyOptional({ enum: MODEL_ARCHITECTURES })
  @IsOptional()
  @IsIn(MODEL_ARCHITECTURES)
  architecture?: typeof MODEL_ARCHITECTURES[number];
}
