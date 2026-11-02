import { Injectable, Logger } from '@nestjs/common';
import { InfiniteDataResponseType } from '@/common/types/infiniteDataResponse.type';
import { CatalogTestProjectionQueryService } from '../projection/catalog-test-projection-query.service';
import { CatalogQueryDto } from './dto/catalogQuery.dto';
import { BenchmarkGroupType } from './types';

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly projectionQuery: CatalogTestProjectionQueryService
  ) {}

  async findGrouped(
    query: CatalogQueryDto
  ): Promise<InfiniteDataResponseType<BenchmarkGroupType>> {
    this.logger.debug('Finding grouped catalog (benchmark groups)');

    return this.projectionQuery.findGrouped(query);
  }
}
