import { PartialType } from '@nestjs/swagger';
import { CreateMetricDefinitionDto } from './create-metric-definition.dto';

export class UpdateMetricDefinitionDto extends PartialType(
  CreateMetricDefinitionDto,
  { skipNullProperties: false }
) {}
