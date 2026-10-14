import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '@/common/dtos/paginationDto.dto';

export class DictionaryListQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description:
      'Parent dictionary id filter (applies only to sub-groups → macroGroupId, subdomains → domainId; ignored elsewhere)',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}
