import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateMetricResultDto } from './create-metric-result.dto';

describe('Metric result source modes', () => {
  it.each(['benchmark', 'stress', 'production', 'comparison', 'harness'])('accepts %s', (sourceMode) => {
    const errors = validateSync(plainToInstance(CreateMetricResultDto, {
      testId: 'test', metricId: '66c5c487-70c1-447f-af32-a0376dfe7fe0', modelId: 'model', value: 80, sourceMode,
    }));
    expect(errors).toEqual([]);
  });
});
