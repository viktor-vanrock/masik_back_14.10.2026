import { Injectable, Logger } from '@nestjs/common';
import { InfiniteDataResponseType } from '@/common/types/infiniteDataResponse.type';
import { BenchmarkSearchService } from '../search/benchmark-search.service';
import { DictionaryRegistry } from './dictionary-registry';
import { DictionaryItemType } from './dictionary.types';
import { DictionaryListQueryDto } from './dto/dictionaryListQuery.dto';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly registry: DictionaryRegistry,
    private readonly benchmarkSearchService: BenchmarkSearchService
  ) {}

  async list(
    category: string,
    type: string,
    query: DictionaryListQueryDto
  ): Promise<InfiniteDataResponseType<DictionaryItemType>> {
    this.logger.debug(`List dictionary "${category}/${type}"`);
    return this.registry.get(category, type).list(query);
  }

  async getOne(
    category: string,
    type: string,
    id: string
  ): Promise<DictionaryItemType> {
    this.logger.debug(`Get dictionary "${category}/${type}" id="${id}"`);
    return this.registry.get(category, type).getOne(id);
  }

  async create(
    category: string,
    type: string,
    body: unknown
  ): Promise<DictionaryItemType> {
    this.logger.debug(`Create dictionary "${category}/${type}"`);
    return this.registry.get(category, type).create(body);
  }

  async update(
    category: string,
    type: string,
    id: string,
    body: unknown
  ): Promise<DictionaryItemType> {
    this.logger.debug(`Update dictionary "${category}/${type}" id="${id}"`);
    const updated = await this.registry.get(category, type).update(id, body);

    try {
      const result = await this.benchmarkSearchService.reindexAll();
      if (result.failed > 0) {
        this.logger.error(
          `Dictionary was updated, but ${result.failed} benchmark search ` +
          'documents could not be reindexed'
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        'Dictionary was updated, but benchmark search reindex failed: ' +
        `category="${category}", type="${type}", id="${id}", ` +
        `error="${message}"`
      );
    }

    return updated;
  }

  async softDelete(
    category: string,
    type: string,
    id: string
  ): Promise<void> {
    this.logger.debug(`Delete dictionary "${category}/${type}" id="${id}"`);
    return this.registry.get(category, type).softDelete(id);
  }
}
