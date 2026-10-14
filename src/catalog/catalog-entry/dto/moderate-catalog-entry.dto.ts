import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { BenchmarkValidationStatus } from '@/generated/prisma/client';

const moderationStatuses = [
  BenchmarkValidationStatus.published,
  BenchmarkValidationStatus.rejected,
] as const;

export class ModerateCatalogEntryDto {
  @ApiProperty({ enum: moderationStatuses })
  @IsIn(moderationStatuses)
  status!:
    | typeof BenchmarkValidationStatus.published
    | typeof BenchmarkValidationStatus.rejected;

  @ApiPropertyOptional({
    maxLength: 2000,
    description: 'Required when the submission is rejected.',
  })
  @ValidateIf(
    (dto: ModerateCatalogEntryDto) =>
      dto.status === BenchmarkValidationStatus.rejected
  )
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'rejectionReason must contain non-whitespace text' })
  @MaxLength(2000)
  rejectionReason?: string;
}
