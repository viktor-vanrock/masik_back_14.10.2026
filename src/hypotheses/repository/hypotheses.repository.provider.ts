import { Provider } from '@nestjs/common';
import { HypothesesRepository } from './hypotheses.repository';
import { IHypothesesRepository } from './hypotheses.repository.interface';

export const hypothesesRepositoryProvider: Provider = {
  provide: IHypothesesRepository,
  useClass: HypothesesRepository,
};
