import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { MODEL_ARCHITECTURES } from '../leaderboard-values';

export class CreateLeaderboardBoardDto {
  @ApiProperty({ maxLength: 80 })
  @Transform(({ value }: { value: unknown }) => 'string' === typeof value ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ maxLength: 240, nullable: true })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(240)
  description?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(160, { each: true })
  modelIds?: string[];

  // Existing API calls these benchmarkIds; the values identify Test cards.
  @ApiPropertyOptional({ type: [String], description: 'IDs of catalog Tests' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(160, { each: true })
  benchmarkIds?: string[];

  @ApiPropertyOptional({ enum: MODEL_ARCHITECTURES, isArray: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(MODEL_ARCHITECTURES.length)
  @ArrayUnique()
  @IsIn(MODEL_ARCHITECTURES, { each: true })
  architectures?: string[];
}
