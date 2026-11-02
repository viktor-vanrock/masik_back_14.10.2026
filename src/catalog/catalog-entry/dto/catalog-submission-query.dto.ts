import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '@/common/dtos/paginationDto.dto';
import { BenchmarkValidationStatus } from '@/generated/prisma/client';

export class CatalogSubmissionQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(BenchmarkValidationStatus)
  status?: BenchmarkValidationStatus;
}
