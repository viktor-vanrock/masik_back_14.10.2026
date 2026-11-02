import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CreateDictionaryItemDto } from './createDictionaryItem.dto';

export class CreateSubdomainDto extends CreateDictionaryItemDto {
  @ApiProperty({
    description: 'Parent domain id (must reference an active row)',
    format: 'uuid',
  })
  @IsUUID()
  domainId!: string;
}
