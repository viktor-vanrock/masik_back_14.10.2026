import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CreateDictionaryItemDto } from './createDictionaryItem.dto';

export class CreateSubGroupDto extends CreateDictionaryItemDto {
  @ApiProperty({
    description: 'Parent macro-group id (must reference an active row)',
    format: 'uuid',
  })
  @IsUUID()
  macroGroupId!: string;
}
