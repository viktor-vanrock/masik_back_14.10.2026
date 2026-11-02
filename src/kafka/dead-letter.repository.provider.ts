import { Provider } from '@nestjs/common';

import { KafkaDeadLetterRepository } from './dead-letter.repository';
import { IKafkaDeadLetterRepository } from './dead-letter.repository.interface';

export const kafkaDeadLetterRepositoryProvider: Provider = {
  provide: IKafkaDeadLetterRepository,
  useClass: KafkaDeadLetterRepository,
};
