import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ExternalBenchmarkTestListResponseDto, ExternalBenchmarkTestDto } from './dto/externalBenchmarkTestResponseDto.dto';
import { ExternalBenchmarkTestSearchDto } from './dto/externalBenchmarkTestSearchDto.dto';
import { ExternalAvailableFieldsResponseDto, ExternalFieldValuesResponseDto } from './dto/externalFieldValuesResponseDto.dto';
import { ExternalBenchmarkTestsProjectionService } from './external-benchmark-tests-projection.service';
import {
  EXTERNAL_BENCHMARK_TEST_FIELDS,
  ExternalBenchmarkTestField,
} from './types';

@Injectable()
export class ExternalBenchmarkTestsService {
  constructor(private readonly projection: ExternalBenchmarkTestsProjectionService) {}

  search(
    dto: ExternalBenchmarkTestSearchDto
  ): Promise<ExternalBenchmarkTestListResponseDto> {
    return this.projection.search(dto);
  }

  findById(id: string): Promise<ExternalBenchmarkTestDto> {
    return this.projection.findById(id);
  }

  getAvailableFields(): ExternalAvailableFieldsResponseDto {
    return { fields: EXTERNAL_BENCHMARK_TEST_FIELDS };
  }

  async getFieldValues(
    field: string
  ): Promise<ExternalFieldValuesResponseDto> {
    if (
      !EXTERNAL_BENCHMARK_TEST_FIELDS.includes(
        field as ExternalBenchmarkTestField
      )
    ) {
      throw new BadRequestException(
        `Unsupported field "${field}". Use GET /external/v1/benchmark-tests/fields to see available fields.`
      );
    }

    return {
      field,
      values: await this.projection.findDistinctValues(
        field as ExternalBenchmarkTestField
      ),
    };
  }

}
