import { PartialType } from '@nestjs/swagger';
import { CreateSubdomainDto } from './createSubdomain.dto';

export class UpdateSubdomainDto extends PartialType(CreateSubdomainDto) {}
