import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { EXTERNAL_API_KEY_SCOPES } from '../external-api-key.constants';

export class CreateExternalApiKeyDto {
  @ApiProperty({
    example: 'benchmark-agent-prod',
    description: 'Human-readable API key name.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({
    example: 'Key for external benchmark agent production integration',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: [
      'benchmark-tests:read',
      'metric-definitions:read',
      'models:write',
      'metric-results:write',
    ],
    description:
      'Permissions granted to the key. Defaults to benchmark-tests:read.',
    enum: EXTERNAL_API_KEY_SCOPES,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[a-z0-9-]+:[a-z0-9-]+$/, { each: true })
  @IsIn(EXTERNAL_API_KEY_SCOPES, { each: true })
  scopes?: string[];

  @ApiPropertyOptional({
    example: '2027-01-01T00:00:00.000Z',
    description: 'Optional expiration datetime. If omitted, key does not expire.',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
