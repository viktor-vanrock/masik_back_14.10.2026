import { PartialType } from '@nestjs/swagger';
import { CreateDictionaryItemDto } from './createDictionaryItem.dto';

export class UpdateDictionaryItemDto extends PartialType(
  CreateDictionaryItemDto
) {}
