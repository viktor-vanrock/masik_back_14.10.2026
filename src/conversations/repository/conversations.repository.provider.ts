import { Provider } from '@nestjs/common';
import { ConversationsRepository } from './conversations.repository';
import { IConversationsRepository } from './conversations.repository.interface';

export const conversationsRepositoryProvider: Provider = {
  provide: IConversationsRepository,
  useClass: ConversationsRepository,
};
