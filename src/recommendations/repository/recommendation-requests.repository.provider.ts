import { Provider } from '@nestjs/common';
import { RecommendationRequestsRepository } from './recommendation-requests.repository';
import { IRecommendationRequestsRepository } from './recommendation-requests.repository.interface';

export const recommendationRequestsRepositoryProvider: Provider = {
  provide: IRecommendationRequestsRepository,
  useClass: RecommendationRequestsRepository,
};
