import { OutboxMessage } from '@/generated/prisma/client';

export type FindPendingOutboxMessagesParams = {
  // Берём только события, которым уже разрешена очередная попытка.
  availableBefore: Date;

  // Ограничиваем размер пачки, чтобы не загружать в память всю таблицу.
  limit: number;
};

export type MarkOutboxMessagePublishedParams = {
  id: string;
  claimToken: string;
  publishedAt: Date;
};

export type MarkOutboxMessageFailedParams = {
  id: string;
  claimToken: string;

  // Момент, после которого publisher сможет повторить отправку.
  availableAt: Date;

  // Сохраняем только безопасное короткое описание ошибки.
  lastError: string;
};


export abstract class IOutboxRepository {
  /**
   * Атомарно арендует и возвращает ещё не опубликованные события,
   * у которых наступило время следующей попытки.
   */
  abstract findPending(params: FindPendingOutboxMessagesParams): Promise<OutboxMessage[]>;

  /**
   * Возвращает true, если строка действительно была обновлена.
   *
   * updateMany вместо update позволит не падать, если событие
   * уже успел обработать другой экземпляр приложения.
   */
  abstract markPublished(params: MarkOutboxMessagePublishedParams): Promise<boolean>;

  /**
   * Увеличивает attempts и переносит следующую попытку в будущее.
   */
  abstract markFailed(params: MarkOutboxMessageFailedParams): Promise<boolean>;
}
