import { InfiniteDataResponseType } from '@/common/types/infiniteDataResponse.type';
import { DictionaryItemType } from '../dictionary.types';
import { DictionaryListQueryDto } from '../dto/dictionaryListQuery.dto';


export abstract class IDictionaryHandler {
  abstract list(
    query: DictionaryListQueryDto,
  ): Promise<InfiniteDataResponseType<DictionaryItemType>>;

  abstract getOne(id: string): Promise<DictionaryItemType>;

  /**
   * @param body Raw JSON body — handler validates against its own DTO class.
   */
  abstract create(body: unknown): Promise<DictionaryItemType>;

  abstract update(id: string, body: unknown): Promise<DictionaryItemType>;

  /**
   * Soft-delete. Refuses with 409 Conflict if `countUsage(id) > 0`.
   */
  abstract softDelete(id: string): Promise<void>;

  /**
   * Number of active references to this row. Surfaced inline on list/getOne
   * responses (admin UI) and consulted before soft-delete.
   */
  abstract countUsage(id: string): Promise<number>;
}
