import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExternalApiKeyResponseDto {
  @ApiProperty({ example: '9e37db3e-8e80-4af1-9d78-e9d80d21ce3e' })
  id!: string;

  @ApiProperty({ example: 'benchmark-agent-prod' })
  name!: string;

  @ApiProperty({
    example: 'bcb_13aef98149a67b2e_V2R0-...',
    description:
      'Raw API key. It is returned only once during creation. Store it safely.',
  })
  apiKey!: string;

  @ApiProperty({ example: 'bcb_13aef98149a67b2e' })
  keyPrefix!: string;

  @ApiPropertyOptional({ example: 'Key for external benchmark agent' })
  description?: string;

  @ApiProperty({ example: ['benchmark-tests:read'], type: [String] })
  scopes!: string[];

  @ApiProperty({ example: 'ACTIVE', enum: ['ACTIVE', 'REVOKED'] })
  status!: string;

  @ApiPropertyOptional({ example: 'aa08db50-2f46-4f38-a6b7-cb4ad24988c7' })
  owner?: string;

  @ApiPropertyOptional({ example: '2027-01-01T00:00:00.000Z' })
  expiresAt?: string;

  @ApiProperty({ example: '2026-06-03T10:00:00.000Z' })
  createdAt!: string;
}

export class ExternalApiKeyPublicDto {
  @ApiProperty({ example: '9e37db3e-8e80-4af1-9d78-e9d80d21ce3e' })
  id!: string;

  @ApiProperty({ example: 'benchmark-agent-prod' })
  name!: string;

  @ApiProperty({ example: 'bcb_13aef98149a67b2e' })
  keyPrefix!: string;

  @ApiPropertyOptional({ example: 'Key for external benchmark agent' })
  description?: string;

  @ApiProperty({ example: ['benchmark-tests:read'], type: [String] })
  scopes!: string[];

  @ApiProperty({ example: 'ACTIVE', enum: ['ACTIVE', 'REVOKED'] })
  status!: string;

  @ApiPropertyOptional({ example: 'aa08db50-2f46-4f38-a6b7-cb4ad24988c7' })
  owner?: string;

  @ApiPropertyOptional({ example: '2027-01-01T00:00:00.000Z' })
  expiresAt?: string;

  @ApiPropertyOptional({ example: '2026-06-03T10:00:00.000Z' })
  revokedAt?: string;

  @ApiPropertyOptional({ example: '2026-06-03T10:00:00.000Z' })
  lastUsedAt?: string;

  @ApiProperty({ example: '2026-06-03T10:00:00.000Z' })
  createdAt!: string;
}
