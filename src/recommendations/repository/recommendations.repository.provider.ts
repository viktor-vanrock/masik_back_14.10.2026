import { Provider } from '@nestjs/common';
import { RecommendationsRepository } from './recommendations.repository';
import { IRecommendationsRepository } from './recommendations.repository.interface';

export const recommendationsRepositoryProvider: Provider = {
  provide: IRecommendationsRepository,
  useClass: RecommendationsRepository,
};
