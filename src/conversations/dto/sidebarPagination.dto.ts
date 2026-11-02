import { Transform } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class SidebarPaginationDto {
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page = 1;
}
