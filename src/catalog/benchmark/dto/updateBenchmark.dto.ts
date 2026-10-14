import { PartialType } from '@nestjs/swagger';
import { CreateBenchmarkDto } from './createBenchmark.dto';

export class UpdateBenchmarkDto extends PartialType(CreateBenchmarkDto, { skipNullProperties: false }) {}
