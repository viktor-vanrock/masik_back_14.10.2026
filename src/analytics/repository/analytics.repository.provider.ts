import { Provider } from '@nestjs/common';
import { AnalyticsRepository } from './analytics.repository';
import { IAnalyticsRepository } from './analytics.repository.interface';

export const analyticsRepositoryProvider: Provider = {
  provide: IAnalyticsRepository,
  useClass: AnalyticsRepository,
};
