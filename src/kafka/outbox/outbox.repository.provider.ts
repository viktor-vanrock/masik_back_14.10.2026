import { Provider } from '@nestjs/common';
import { OutboxRepository } from './outbox.repository';
import { IOutboxRepository } from './outbox.repository.interface';

export const outboxRepositoryProvider: Provider = {
  provide: IOutboxRepository,
  useClass: OutboxRepository,
};
