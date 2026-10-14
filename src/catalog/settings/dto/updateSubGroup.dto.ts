import { PartialType } from '@nestjs/swagger';
import { CreateSubGroupDto } from './createSubGroup.dto';

export class UpdateSubGroupDto extends PartialType(CreateSubGroupDto) {}
