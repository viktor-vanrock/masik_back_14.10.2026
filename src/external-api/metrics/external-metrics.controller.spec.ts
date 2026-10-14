import 'reflect-metadata';

import { MetricsService } from '@/metrics/metrics.service';
import {
  EXTERNAL_API_KEY_SCOPES_KEY,
  EXTERNAL_API_KEY_SCOPE,
} from '../api-keys/external-api-key.constants';
import { ExternalMetricResultsController } from '../metric-results/external-metric-results.controller';
import { ExternalModelsController } from '../models/external-models.controller';
import { ExternalMetricsController } from './external-metrics.controller';

function scopesOf<T extends object, K extends keyof T>(
  prototype: T,
  methodName: K
): unknown {
  const method = prototype[methodName];
  if ('function' !== typeof method) {
    throw new TypeError('Expected a controller method');
  }

  return Reflect.getMetadata(EXTERNAL_API_KEY_SCOPES_KEY, method);
}

describe('External metrics controllers', () => {
  const createMetric = jest.fn();
  const findAllMetrics = jest.fn();
  const findMetricById = jest.fn();
  const findAllPriorities = jest.fn();
  const findAllDirections = jest.fn();
  const createModel = jest.fn();
  const findAllModels = jest.fn();
  const createMetricResult = jest.fn();
  const findMetricResultsByTestId = jest.fn();

  const metricsService = {
    createMetric,
    findAllMetrics,
    findMetricById,
    findAllPriorities,
    findAllDirections,
    createModel,
    findAllModels,
    createMetricResult,
    findMetricResultsByTestId,
  } as unknown as MetricsService;

  const metricsController = new ExternalMetricsController(metricsService);
  const modelsController = new ExternalModelsController(metricsService);
  const resultsController = new ExternalMetricResultsController(metricsService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates metric definition creation to MetricsService', async () => {
    const dto = {
      name: 'postman_accuracy',
      priorityId: '65dd00e2-f5af-4e58-81ea-a360313a2f00',
      directionId: '86c3b770-ab1b-4142-a8e8-f8c0e0a9a214',
    };
    const created = { id: 'metric-id', ...dto };
    createMetric.mockResolvedValue(created);

    await expect(metricsController.createMetric(dto)).resolves.toEqual(created);
    expect(createMetric).toHaveBeenCalledWith(dto);
  });

  it('delegates model upsert to MetricsService', async () => {
    const dto = {
      id: 'external-model',
      name: 'External Model',
    };
    const model = { ...dto, isOpenSource: false };
    createModel.mockResolvedValue(model);

    await expect(modelsController.createModel(dto)).resolves.toEqual(model);
    expect(createModel).toHaveBeenCalledWith(dto);
  });

  it('delegates metric result creation to MetricsService', async () => {
    const dto = {
      testId: 'benchmark-test',
      metricId: '65dd00e2-f5af-4e58-81ea-a360313a2f00',
      modelId: 'external-model',
      value: 0.91,
    };
    const result = { id: 'result-id', ...dto };
    createMetricResult.mockResolvedValue(result);

    await expect(resultsController.createMetricResult(dto)).resolves.toEqual(
      result
    );
    expect(createMetricResult).toHaveBeenCalledWith(dto);
  });

  it('delegates paginated metric result lookup to MetricsService', async () => {
    const queryParams = {
      page: 2,
      limit: 25,
      search: 'accuracy',
      sortColumn: 'obtainedAt',
    };
    const response = {
      data: [{ id: 'result-id' }],
      total: 26,
    };
    findMetricResultsByTestId.mockResolvedValue(response);

    await expect(
      resultsController.findMetricResultsByTestId(
        'benchmark-test',
        queryParams
      )
    ).resolves.toEqual(response);

    expect(findMetricResultsByTestId).toHaveBeenCalledWith(
      'benchmark-test',
      queryParams
    );
  });

  it('assigns separate read and write scopes to metric endpoints', () => {
    expect(
      scopesOf(ExternalMetricsController.prototype, 'findAllMetrics')
    ).toEqual([EXTERNAL_API_KEY_SCOPE.METRIC_DEFINITIONS_READ]);

    expect(
      scopesOf(ExternalMetricsController.prototype, 'createMetric')
    ).toEqual([EXTERNAL_API_KEY_SCOPE.METRIC_DEFINITIONS_WRITE]);
  });

  it('assigns separate scopes to model and result endpoints', () => {
    expect(
      scopesOf(ExternalModelsController.prototype, 'createModel')
    ).toEqual([EXTERNAL_API_KEY_SCOPE.MODELS_WRITE]);

    expect(
      scopesOf(ExternalMetricResultsController.prototype, 'createMetricResult')
    ).toEqual([EXTERNAL_API_KEY_SCOPE.METRIC_RESULTS_WRITE]);

    expect(
      scopesOf(ExternalMetricResultsController.prototype, 'findMetricResultsByTestId')
    ).toEqual([EXTERNAL_API_KEY_SCOPE.METRIC_RESULTS_READ]);
  });
});
