import { Transform } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { SortDirection } from '@/common/enums/sortDirection.enum';

export class PaginationDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1, { message: 'Page number must be greater than 0' })
  page: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1, { message: 'Limit must be greater than 0' })
  limit: number = 1000;

  @IsOptional()
  @IsString()
  sortColumn?: string;

  @IsOptional()
  @IsEnum(SortDirection, { message: 'Sort direction must be either asc or desc' })
  sortDirection?: SortDirection = SortDirection.Desc;
}
