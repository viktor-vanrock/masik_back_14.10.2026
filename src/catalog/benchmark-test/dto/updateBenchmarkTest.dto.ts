import { PartialType } from '@nestjs/swagger';
import { CreateBenchmarkTestDto } from './createBenchmarkTest.dto';

export class UpdateBenchmarkTestDto extends PartialType(
  CreateBenchmarkTestDto,
  { skipNullProperties: false }
) { }
