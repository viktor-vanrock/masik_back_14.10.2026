import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Public } from '@/common/decorators/public.decorator';
import { CatalogService } from './catalog.service';
import { CatalogQueryDto } from './dto/catalogQuery.dto';
import {
  BenchmarkGroupDto,
  BenchmarkGroupSuiteDto,
  CatalogPaginatedResponseDto,
} from './dto/catalogResponse.dto';

@ApiTags('catalog')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
@ApiExtraModels(
  BenchmarkGroupSuiteDto,
  BenchmarkGroupDto,
  CatalogPaginatedResponseDto
)
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService
  ) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Get grouped benchmark catalog',
    description: [
      'Main catalog read-model. Returns paginated benchmark suites (groups) with their BenchmarkTest items in one request. Public — no JWT required.',
      '',
      '**Pagination is by groups, not by tests.** A suite group is never split across pages.',
      '',
      '**Empty groups are hidden.** If a suite has 0 tests matching the current filters/search, it is not returned.',
      '',
      '**Search Variant A:**',
      '- If `search` matches `Benchmark.name` / `nameEn`, the entire group is returned with all tests passing non-search filters (search does not narrow tests inside the matched suite).',
      '- If `search` matches only test fields, the group is returned with just the matching tests.',
      '',
      '**Counters:**',
      '- `benchmarkTestsCount` — total active tests in the suite.',
      '- `matchedTestsCount` — tests passing current filters/search.',
      '- `tests.length` — actually returned in this response (currently equals `matchedTestsCount`).',
    ].join('\n'),
  })
  @ApiOkResponse({
    description: 'Paginated benchmark groups',
    type: CatalogPaginatedResponseDto,
  })
  async findGrouped(@Query() query: CatalogQueryDto) {
    return await this.catalogService.findGrouped(query);
  }
}
