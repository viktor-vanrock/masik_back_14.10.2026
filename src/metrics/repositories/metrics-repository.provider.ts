import { Provider } from '@nestjs/common';
import { MetricsRepository } from './metrics.repository';
import { IMetricsRepository } from './metrics.repository.interface';

export const metricsRepositoryProvider: Provider = {
  provide: IMetricsRepository,
  useClass: MetricsRepository,
};
